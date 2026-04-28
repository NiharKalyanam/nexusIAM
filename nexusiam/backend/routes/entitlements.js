const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const logger = require('../config/logger');
const { cacheGet, cacheSet, cacheDel } = require('../config/redis');

// Cache TTL for the entitlement catalog (applications list + attribute/type dropdowns)
// 3 minutes — safe because catalog changes only when entitlements are added/modified
const TTL_CATALOG = 3 * 60;
const KEY_CATALOG = (tid) => `entitlements:catalog:${tid}`;

function buildFilters(query, tenantId) {
  const where = ['x.tenant_id = $1'];
  const params = [tenantId];
  let idx = 2;

  if (query.application_id) { where.push(`x.application_id = $${idx++}`); params.push(query.application_id); }
  if (query.type) { where.push(`LOWER(COALESCE(x.type,'')) = LOWER($${idx++})`); params.push(query.type); }
  if (query.attribute) { where.push(`LOWER(COALESCE(x.attribute,'')) = LOWER($${idx++})`); params.push(query.attribute); }
  if (query.value) { where.push(`COALESCE(x.value,'') ILIKE $${idx++}`); params.push(`%${query.value}%`); }
  if (query.owner) { where.push(`COALESCE(x.owner,'') ILIKE $${idx++}`); params.push(`%${query.owner}%`); }
  if (query.classification) { where.push(`COALESCE(x.classification,'') ILIKE $${idx++}`); params.push(`%${query.classification}%`); }
  if (query.requestable === 'true' || query.requestable === 'false') { where.push(`COALESCE(x.requestable,false) = $${idx++}`); params.push(query.requestable === 'true'); }
  // Filter by connector: look up application linked to this connector
  if (query.connector_id) {
    // Match entitlements via linked application OR directly via metadata connector_id
    // (for group entitlements that have no application_id)
    where.push(`(
      x.application_id IN (
        SELECT id FROM applications
        WHERE tenant_id = $1
          AND (
            metadata->>'connector_id' = $${idx}
            OR provisioning_config->>'connector_id' = $${idx}
          )
      )
      OR (x.application_id IS NULL AND x.metadata->>'connector_id' = $${idx})
      OR (x.source = 'discovered' AND x.metadata->>'connector_id' = $${idx})
    )`);
    params.push(query.connector_id);
    idx++;
  }

  return { where: where.join(' AND '), params, idx };
}

const datasetSql = `
WITH managed AS (
  SELECT e.id,
         e.tenant_id,
         e.application_id,
         a.name AS application_name,
         COALESCE(c.type, '') AS connector_type,
         COALESCE(e.type, 'entitlement') AS type,
         COALESCE(e.metadata->>'attribute', e.type, 'entitlement') AS attribute,
         e.value,
         e.name AS display_name,
         e.description,
         COALESCE((e.metadata->>'requestable')::boolean, false) AS requestable,
         COALESCE(e.metadata->>'owner', '') AS owner,
         e.owner_id,
         e.owner_type,
         e.owner_workgroup_id,
         COALESCE(
           (SELECT u.first_name || ' ' || u.last_name FROM users u WHERE u.id = e.owner_id),
           (SELECT wg.name FROM workgroups wg WHERE wg.id = e.owner_workgroup_id),
           ''
         ) AS owner_name,
         COALESCE(e.elevated_access, (e.metadata->>'elevated_access')::boolean, false) AS elevated_access,
         COALESCE(e.metadata->>'classification', '') AS classification,
         COALESCE((
           SELECT COUNT(DISTINCT aai.account_link_id)::int
             FROM account_access_items aai
             JOIN applications a2 ON a2.tenant_id = e.tenant_id
                                AND COALESCE(a2.metadata->>'connector_id', a2.provisioning_config->>'connector_id') = aai.connector_id::text
            WHERE a2.id = e.application_id
              AND aai.access_value = e.value
              AND aai.access_type = COALESCE(e.type, aai.access_type)
         ), 0) AS account_count,
         e.metadata,
         e.created_at,
         'managed' AS source
    FROM entitlements e
    LEFT JOIN applications a ON a.id = e.application_id
    LEFT JOIN connectors c ON c.id = NULLIF(a.metadata->>'connector_id', '')::uuid
      AND c.tenant_id = e.tenant_id
),
discovered AS (
  -- Linked app: include access items that belong to a known application
  SELECT md5(app.id::text || ':' || aai.access_type || ':' || aai.access_value)::uuid AS id,
         app.tenant_id,
         app.id AS application_id,
         app.name AS application_name,
         COALESCE(dc.type, '') AS connector_type,
         aai.access_type AS type,
         aai.access_type AS attribute,
         aai.access_value AS value,
         COALESCE(NULLIF(aai.display_name, ''), aai.access_value) AS display_name,
         COALESCE(NULLIF(aai.display_name, ''), aai.access_value) AS description,
         false AS requestable,
         '' AS owner,
         NULL::uuid AS owner_id,
         'identity' AS owner_type,
         NULL::uuid AS owner_workgroup_id,
         '' AS owner_name,
         false AS elevated_access,
         '' AS classification,
         COUNT(DISTINCT aai.account_link_id)::int AS account_count,
         jsonb_build_object('connector_id', aai.connector_id) AS metadata,
         MAX(aai.last_seen_at) AS created_at,
         'discovered' AS source
    FROM account_access_items aai
    JOIN applications app ON app.tenant_id = aai.tenant_id
                         AND COALESCE(app.metadata->>'connector_id', app.provisioning_config->>'connector_id') = aai.connector_id::text
    LEFT JOIN connectors dc ON dc.id = aai.connector_id
   WHERE NOT EXISTS (
         SELECT 1 FROM entitlements e
          WHERE e.tenant_id = aai.tenant_id
            AND e.application_id = app.id
            AND COALESCE(e.type, '') = COALESCE(aai.access_type, '')
            AND COALESCE(e.value, '') = COALESCE(aai.access_value, '')
   )
   GROUP BY app.tenant_id, app.id, app.name, aai.connector_id, dc.type, aai.access_type, aai.access_value, COALESCE(NULLIF(aai.display_name, ''), aai.access_value)
  UNION ALL
  -- No linked app: still surface access items aggregated by connectors with no application
  SELECT md5(aai.tenant_id::text || ':' || aai.connector_id::text || ':' || aai.access_type || ':' || aai.access_value)::uuid AS id,
         aai.tenant_id,
         NULL AS application_id,
         COALESCE(cn.name, 'Unknown Connector') || ' (No App Linked)' AS application_name,
         COALESCE(cn.type, '') AS connector_type,
         aai.access_type AS type,
         aai.access_type AS attribute,
         aai.access_value AS value,
         COALESCE(NULLIF(aai.display_name, ''), aai.access_value) AS display_name,
         COALESCE(NULLIF(aai.display_name, ''), aai.access_value) AS description,
         false AS requestable,
         '' AS owner,
         NULL::uuid AS owner_id,
         'identity' AS owner_type,
         NULL::uuid AS owner_workgroup_id,
         '' AS owner_name,
         false AS elevated_access,
         '' AS classification,
         COUNT(DISTINCT aai.account_link_id)::int AS account_count,
         jsonb_build_object('connector_id', aai.connector_id) AS metadata,
         MAX(aai.last_seen_at) AS created_at,
         'discovered' AS source
    FROM account_access_items aai
    LEFT JOIN connectors cn ON cn.id = aai.connector_id
   WHERE NOT EXISTS (
         SELECT 1 FROM applications app2
          WHERE app2.tenant_id = aai.tenant_id
            AND COALESCE(app2.metadata->>'connector_id', app2.provisioning_config->>'connector_id') = aai.connector_id::text
   )
     AND NOT EXISTS (
         SELECT 1 FROM entitlements e
          WHERE e.tenant_id = aai.tenant_id
            AND COALESCE(e.type, '') = COALESCE(aai.access_type, '')
            AND COALESCE(e.value, '') = COALESCE(aai.access_value, '')
   )
   GROUP BY aai.tenant_id, aai.connector_id, cn.name, cn.type, aai.access_type, aai.access_value, COALESCE(NULLIF(aai.display_name, ''), aai.access_value)
),
unioned AS (
  SELECT * FROM managed
  UNION ALL
  SELECT * FROM discovered
)
SELECT x.* FROM unioned x`;

router.get('/catalog', authenticate, async (req, res) => {
  const tid = req.tenantId;
  try {
    // ── Try Redis first ───────────────────────────────────────────────────
    const cached = await cacheGet(KEY_CATALOG(tid));
    if (cached) {
      logger.info('[ENTITLEMENTS] Catalog served from Redis cache', { tenantId: tid });
      return res.json(cached);
    }

    // ── Cache miss — query DB ─────────────────────────────────────────────
    logger.info('[ENTITLEMENTS] Catalog cache miss — querying DB', { tenantId: tid });
    const [apps, attrs, types] = await Promise.all([
      db.query('SELECT id, name FROM applications WHERE tenant_id=$1 ORDER BY name', [tid]),
      db.query(`SELECT attribute FROM (${datasetSql}) x WHERE x.tenant_id = $1 GROUP BY attribute ORDER BY attribute`, [tid]),
      db.query(`SELECT type FROM (${datasetSql}) x WHERE x.tenant_id = $1 GROUP BY type ORDER BY type`, [tid]),
    ]);

    const payload = {
      applications: apps.rows,
      attributes:   attrs.rows.map(r => r.attribute).filter(Boolean),
      types:        types.rows.map(r => r.type).filter(Boolean),
    };

    // ── Store in cache ────────────────────────────────────────────────────
    const stored = await cacheSet(KEY_CATALOG(tid), payload, TTL_CATALOG);
    logger.info('[ENTITLEMENTS] Catalog loaded from DB', {
      tenantId:    tid,
      apps:        payload.applications.length,
      attributes:  payload.attributes.length,
      types:       payload.types.length,
      cachedInRedis: stored,
    });

    res.json(payload);
  } catch (err) {
    logger.error('[ENTITLEMENTS] Catalog endpoint error', { tenantId: tid, error: err.message });
    res.status(500).json({ error: 'Failed to load entitlement catalog metadata' });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.max(parseInt(req.query.limit || '25', 10), 1);
    const offset = (page - 1) * limit;
    const { where, params, idx } = buildFilters(req.query, req.tenantId);

    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM (${datasetSql}) x WHERE ${where}`, params);
    const dataRes = await db.query(
      `SELECT * FROM (${datasetSql}) x WHERE ${where}
       ORDER BY application_name NULLS LAST, display_name NULLS LAST, value NULLS LAST
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json({
      data: dataRes.rows,
      pagination: { total: countRes.rows[0]?.total || 0, page, limit, pages: Math.ceil((countRes.rows[0]?.total || 0) / limit) },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch entitlements' });
  }
});

// ── Full entitlement update (owner, display_value, elevated_access, classification, custom_metadata)
router.put('/:id', authenticate, auditLog('entitlement.update'), async (req, res) => {
  try {
    const {
      display_value, description, requestable, elevated_access,
      classification, owner_id, owner_type, owner_workgroup_id, custom_metadata
    } = req.body;

    // Get existing (managed only)
    const existing = await db.query(
      'SELECT * FROM entitlements WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.tenantId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Entitlement not found or is read-only (discovered)' });

    const old = existing.rows[0];
    const mergedMeta = {
      ...(old.metadata || {}),
      ...(custom_metadata || {}),
      requestable: requestable !== undefined ? !!requestable : (old.metadata?.requestable ?? false),
      elevated_access: elevated_access !== undefined ? !!elevated_access : (old.metadata?.elevated_access ?? false),
      classification: classification !== undefined ? (classification || null) : (old.metadata?.classification || null),
    };

    const { rows } = await db.query(
      `UPDATE entitlements SET
         name        = COALESCE($1, name),
         description = COALESCE($2, description),
         metadata    = $3::jsonb,
         owner_id    = $4,
         owner_type  = COALESCE($5, 'identity'),
         owner_workgroup_id = $6,
         elevated_access    = $7,
         display_value      = COALESCE($8, display_value),
         updated_at  = NOW()
       WHERE id=$9 AND tenant_id=$10 RETURNING *`,
      [
        display_value || null,
        description !== undefined ? description : null,
        JSON.stringify(mergedMeta),
        owner_id || null,
        owner_type || 'identity',
        owner_workgroup_id || null,
        elevated_access !== undefined ? !!elevated_access : (old.elevated_access ?? false),
        display_value || null,
        req.params.id,
        req.tenantId,
      ]
    );
    res.json(rows[0]);
    // Invalidate catalog cache so next catalog request reflects changes
    cacheDel(KEY_CATALOG(req.tenantId)).then(ok =>
      logger.info('[ENTITLEMENTS] Catalog cache invalidated after update', { tenantId: req.tenantId, ok })
    );
  } catch (err) {
    logger.error('[ENTITLEMENTS] update error', { error: err.message });
    res.status(500).json({ error: 'Failed to update entitlement' });
  }
});

router.put('/:id/requestable', authenticate, auditLog('entitlement.requestable.update'), async (req, res) => {
  try {
    const requestable = !!req.body.requestable;
    const existing = await db.query('SELECT * FROM entitlements WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (existing.rows.length) {
      const metadata = { ...(existing.rows[0].metadata || {}), requestable };
      const { rows } = await db.query('UPDATE entitlements SET metadata=$1 WHERE id=$2 RETURNING *', [JSON.stringify(metadata), req.params.id]);
      return res.json(rows[0]);
    }

    // Discovered entitlement (synthetic id from md5 hash) — promote to managed row
    // Find matching account_access_item to reconstruct it
    const discQ = await db.query(`
      SELECT aai.access_type, aai.access_value, aai.display_name, aai.connector_id,
             app.id AS application_id, app.name AS application_name
        FROM account_access_items aai
        JOIN applications app ON app.tenant_id = aai.tenant_id
                             AND COALESCE(app.metadata->>'connector_id', app.provisioning_config->>'connector_id') = aai.connector_id::text
       WHERE aai.tenant_id = $1
         AND md5(app.id::text || ':' || aai.access_type || ':' || aai.access_value)::uuid = $2
       LIMIT 1`, [req.tenantId, req.params.id]);

    if (!discQ.rows.length) {
      return res.status(404).json({ error: 'Entitlement not found' });
    }
    const d = discQ.rows[0];
    const { rows: inserted } = await db.query(
      `INSERT INTO entitlements (tenant_id, application_id, name, description, type, value, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
      [req.tenantId, d.application_id,
       d.display_name || d.access_value,
       d.display_name || d.access_value,
       d.access_type, d.access_value,
       JSON.stringify({ requestable, connector_id: d.connector_id, promoted_from: 'discovered' })]
    );
    return res.json(inserted[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update requestable flag' });
  }
});

router.get('/export/file', authenticate, async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query, req.tenantId);
    const { rows } = await db.query(`SELECT * FROM (${datasetSql}) x WHERE ${where} ORDER BY application_name, display_name, value`, params);
    const header = ['application_name','attribute','display_name','type','description','owner','requestable','classification','value','account_count'];
    const csv = [header.join(',')].concat(rows.map(r => header.map((k) => {
      const val = r[k] == null ? '' : String(r[k]).replace(/"/g, '""');
      return `"${val}"`;
    }).join(','))).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="entitlements.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export entitlements' });
  }
});

router.post('/import', authenticate, auditLog('entitlement.import'), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'No entitlement items supplied' });
    let imported = 0;
    for (const item of items) {
      if (!item.application_id || !item.value) continue;
      const metadata = {
        requestable: !!item.requestable,
        owner: item.owner || '',
        classification: item.classification || '',
        attribute: item.attribute || item.type || 'entitlement',
      };
      await db.query(
        `INSERT INTO entitlements (tenant_id, application_id, name, description, type, value, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [req.tenantId, item.application_id, item.display_name || item.name || item.value, item.description || '', item.type || 'entitlement', item.value, JSON.stringify(metadata)]
      );
      imported += 1;
    }
    res.status(201).json({ success: true, imported });
    cacheDel(KEY_CATALOG(req.tenantId)).then(ok =>
      logger.info('[ENTITLEMENTS] Catalog cache invalidated after import', { tenantId: req.tenantId, imported, ok })
    );
  } catch (err) {
    logger.error('[ENTITLEMENTS] import error', { error: err.message });
    res.status(500).json({ error: 'Failed to import entitlements' });
  }
});

// DELETE /:id — delete single entitlement
router.delete('/:id', authenticate, auditLog('entitlement.delete'), async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM entitlements WHERE id=$1 AND tenant_id=$2 RETURNING id, name',
      [req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Entitlement not found' });
    res.json({ success: true, deleted: rows[0] });
    cacheDel(KEY_CATALOG(req.tenantId)).then(ok =>
      logger.info('[ENTITLEMENTS] Catalog cache invalidated after delete', { tenantId: req.tenantId, id: req.params.id, ok })
    );
  } catch (err) {
    logger.error('[ENTITLEMENTS] delete error', { error: err.message });
    res.status(500).json({ error: 'Failed to delete entitlement: ' + err.message });
  }
});

// POST /bulk-delete — delete multiple entitlements
router.post('/bulk-delete', authenticate, auditLog('entitlement.bulk_delete'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const { rows } = await db.query(
      `DELETE FROM entitlements WHERE id = ANY($1::uuid[]) AND tenant_id=$2 RETURNING id, name`,
      [ids, req.tenantId]
    );
    res.json({ success: true, deleted: rows.length, names: rows.map(r => r.name) });
    cacheDel(KEY_CATALOG(req.tenantId)).then(ok =>
      logger.info('[ENTITLEMENTS] Catalog cache invalidated after bulk delete', { tenantId: req.tenantId, count: rows.length, ok })
    );
  } catch (err) {
    logger.error('[ENTITLEMENTS] bulk delete error', { error: err.message });
    res.status(500).json({ error: 'Failed to bulk delete entitlements: ' + err.message });
  }
});

module.exports = router;