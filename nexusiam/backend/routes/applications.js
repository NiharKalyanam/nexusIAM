const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const ProvisioningEngine = require('../services/provisioning/ProvisioningEngine');
const SchemaEngine = require('../services/schema/SchemaEngine');
const EmailService = require('../services/email/EmailService');

async function getUserRoles(userId) {
  const { rows } = await db.query(
    `SELECT r.name
       FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND ur.status = 'active'`,
    [userId]
  );
  return rows.map((r) => r.name);
}

async function ensureSuperAdmin(req, res) {
  const roles = await getUserRoles(req.user.id);
  if (!roles.includes('Super Admin')) {
    res.status(403).json({ error: 'Only Super Admin can delete applications' });
    return false;
  }
  return true;
}

function parseJsonMaybe(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function loadApplication(appId, tenantId) {
  const { rows } = await db.query(`SELECT * FROM applications WHERE id=$1 AND tenant_id=$2`, [appId, tenantId]);
  if (!rows[0]) return null;
  return {
    ...rows[0],
    metadata: parseJsonMaybe(rows[0].metadata),
    provisioning_config: parseJsonMaybe(rows[0].provisioning_config),
  };
}

async function resolveApplicationConnectorId(app) {
  // 1. Direct stored reference — verify it still exists in this tenant
  const direct = app?.metadata?.connector_id || app?.provisioning_config?.connector_id || null;
  if (direct) {
    const { rows: chk } = await db.query(
      'SELECT id FROM connectors WHERE id=$1 AND tenant_id=$2',
      [direct, app.tenant_id]
    );
    if (chk.length) return chk[0].id;
  }

  // 2. Fuzzy name match — strip "Application" suffix, case-insensitive
  const { rows } = await db.query(
    `SELECT c.id FROM connectors c
      WHERE c.tenant_id = $1
        AND (
          lower(c.name) = lower($2)
          OR lower(c.name) = lower($3)
          OR lower(regexp_replace(c.name, ' Application$', '', 'i')) = lower(regexp_replace($2, ' Application$', '', 'i'))
        )
      ORDER BY c.created_at DESC LIMIT 1`,
    [app.tenant_id, app.name, app.name.replace(/ Application$/i, '')]
  );
  return rows[0]?.id || null;
}

async function loadApplicationSchema(app) {
  const connectorId = await resolveApplicationConnectorId(app);
  if (!connectorId) return { schema: [], source: 'none', connector_id: null };

  const saved = await SchemaEngine.getSchema(connectorId);
  const custom = await SchemaEngine.listCustomAttributes(connectorId);

  let schema = Array.isArray(saved) && saved.length ? [...saved] : [];
  let source = Array.isArray(saved) && saved.length ? 'connector_discovered' : 'connector_registry';

  // Always fall back to nativeSchema from registry if no discovery has run yet
  if (!schema.length) {
    const { rows } = await db.query('SELECT type FROM connectors WHERE id=$1', [connectorId]);
    const type = rows[0]?.type;
    try {
      const def = require('../services/connectors/ConnectorRegistry').CONNECTORS[type];
      if (def?.nativeSchema?.length) {
        schema = def.nativeSchema.map(f => ({ ...f }));
        source = 'connector_registry';
      }
    } catch {}
  }

  // Merge custom attributes
  const existingNames = new Set(schema.map((s) => s.name));
  for (const a of custom) {
    if (!existingNames.has(a.attribute_name)) {
      schema.push({
        name: a.attribute_name,
        type: a.attribute_type,
        description: a.description,
        isCustom: true,
      });
    }
  }

  return { schema, source, connector_id: connectorId };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT a.*, a.metadata, COUNT(DISTINCT ur.user_id) as user_count,
              COALESCE(u.first_name || ' ' || u.last_name, wg.name) AS owner_name
       FROM applications a
       LEFT JOIN user_roles ur ON ur.role_id IN (SELECT id FROM roles WHERE tenant_id=a.tenant_id)
       LEFT JOIN users u ON u.id = a.owner_id AND a.owner_type = 'identity'
       LEFT JOIN workgroups wg ON wg.id = a.owner_workgroup_id
       WHERE a.tenant_id=$1 GROUP BY a.id, u.first_name, u.last_name, wg.name ORDER BY a.name`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch applications' }); }
});

router.post('/', authenticate, auditLog('application.create'), async (req, res) => {
  try {
    const { name, description, type, sso_enabled, sso_protocol, sso_config, provisioning_enabled, provisioning_type, provisioning_config, metadata, is_authoritative, is_sox, is_birthright, owner_id, owner_type, owner_workgroup_id } = req.body;
    const connectorId = metadata?.connector_id || provisioning_config?.connector_id || null;
    const mergedMeta = { ...(metadata || {}), connector_id: connectorId };
    const mergedProv = { ...(provisioning_config || {}), connector_id: connectorId };
    const { rows } = await db.query(
      `INSERT INTO applications (tenant_id, name, description, type, sso_enabled, sso_protocol, sso_config, provisioning_enabled, provisioning_type, provisioning_config, owner_id, owner_type, owner_workgroup_id, metadata, is_authoritative, is_sox, is_birthright)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [req.tenantId, name, description, type, sso_enabled||false, sso_protocol, JSON.stringify(sso_config||{}), provisioning_enabled||false, provisioning_type, JSON.stringify(mergedProv), owner_id || req.user.id, owner_type || 'identity', owner_workgroup_id || null, JSON.stringify(mergedMeta), !!is_authoritative, !!is_sox, !!is_birthright]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to create application' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const app = await loadApplication(req.params.id, req.tenantId);
    if (!app) return res.status(404).json({ error: 'Not found' });
    const schemaSummary = await loadApplicationSchema(app);
    res.json({ ...app, schema: schemaSummary.schema, schema_source: schemaSummary.source });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch application' }); }
});

router.put('/:id', authenticate, auditLog('application.update'), async (req, res) => {
  try {
    const { name, description, type, sso_enabled, sso_protocol, sso_config, provisioning_enabled, status, provisioning_type, provisioning_config, metadata, is_authoritative, is_sox, is_birthright, owner_id, owner_type, owner_workgroup_id } = req.body;
    const connectorId = metadata?.connector_id || provisioning_config?.connector_id || null;
    const mergedMeta = { ...(metadata || {}), connector_id: connectorId };
    const mergedProv = { ...(provisioning_config || {}), connector_id: connectorId };
    const { rows } = await db.query(
      `UPDATE applications SET name=$1, description=$2, type=$3, sso_enabled=$4, sso_protocol=$5, sso_config=$6, provisioning_enabled=$7, status=$8, provisioning_type=$9, provisioning_config=$10, metadata=$11, is_authoritative=$12, is_sox=$13, owner_id=$14, owner_type=$15, owner_workgroup_id=$16, is_birthright=$17, updated_at=NOW()
       WHERE id=$18 AND tenant_id=$19 RETURNING *`,
      [name, description, type, sso_enabled, sso_protocol, JSON.stringify(sso_config||{}), provisioning_enabled, status||'active', provisioning_type || null, JSON.stringify(mergedProv), JSON.stringify(mergedMeta), !!is_authoritative, !!is_sox, owner_id || null, owner_type || 'identity', owner_workgroup_id || null, !!is_birthright, req.params.id, req.tenantId]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to update application' }); }
});

router.get('/:id/schema', authenticate, async (req, res) => {
  try {
    const app = await loadApplication(req.params.id, req.tenantId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const result = await loadApplicationSchema(app);
    res.json({ application_id: app.id, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load application schema' });
  }
});

router.get('/:id/accounts', authenticate, async (req, res) => {
  try {
    const app = await loadApplication(req.params.id, req.tenantId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const connectorId = await resolveApplicationConnectorId(app);
    if (!connectorId) return res.json({ application: app, connector: null, accounts: [], pagination: { total: 0, page: 1, limit: 20, pages: 0 } });
    const connRows = await db.query(`SELECT id, name, type, status FROM connectors WHERE id=$1 AND tenant_id=$2`, [connectorId, req.tenantId]);
    const result = await ProvisioningEngine.listAccountLinks(connectorId, req.tenantId, { page: req.query.page, limit: req.query.limit || 20 });
    res.json({ application: app, connector: connRows.rows[0] || null, accounts: result.data, pagination: { total: result.total, page: result.page, limit: result.limit, pages: result.pages } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch application accounts' });
  }
});

router.get('/:id/accounts/:accountId', authenticate, async (req, res) => {
  try {
    const app = await loadApplication(req.params.id, req.tenantId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const connectorId = await resolveApplicationConnectorId(app);
    if (!connectorId) return res.status(404).json({ error: 'No linked connector' });

    const { rows } = await db.query(
      `SELECT al.*, u.username AS linked_username, u.email AS linked_email,
              COALESCE(aic.access_count, 0) AS access_count,
              COALESCE(aic.access_items, '[]'::jsonb) AS access_items
         FROM account_links al
         LEFT JOIN users u ON u.id = al.user_id
         LEFT JOIN (
           SELECT aai.account_link_id,
                  COUNT(*) AS access_count,
                  jsonb_agg(jsonb_build_object(
                    'id', aai.id,
                    'type', aai.access_type,
                    'value', aai.access_value,
                    'display_name', aai.display_name,
                    'raw_item', aai.raw_item
                  ) ORDER BY aai.access_type, aai.display_name) AS access_items
             FROM account_access_items aai
            GROUP BY aai.account_link_id
         ) aic ON aic.account_link_id = al.id
        WHERE al.id = $1 AND al.connector_id = $2 AND al.tenant_id = $3`,
      [req.params.accountId, connectorId, req.tenantId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Account not found' });
    res.json({ account: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch account details' });
  }
});

router.get('/:id/entitlements', authenticate, async (req, res) => {
  try {
    const app = await loadApplication(req.params.id, req.tenantId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const connectorId = await resolveApplicationConnectorId(app);

    const params = [req.tenantId, req.params.id];
    let connectorClause = '';
    if (connectorId) {
      params.push(connectorId);
      connectorClause = ` OR (e.application_id IS NULL AND src.connector_id = $3)`;
    }

    const { rows } = await db.query(
      `WITH src AS (
         SELECT aai.connector_id,
                aai.access_type,
                aai.access_value,
                COALESCE(NULLIF(aai.display_name, ''), aai.access_value) AS display_name,
                COUNT(DISTINCT aai.account_link_id)::int AS account_count,
                MAX(aai.last_seen_at) AS last_seen_at
           FROM account_access_items aai
          WHERE aai.tenant_id = $1
          GROUP BY aai.connector_id, aai.access_type, aai.access_value, COALESCE(NULLIF(aai.display_name, ''), aai.access_value)
       )
       SELECT COALESCE(e.id, md5(COALESCE(src.connector_id::text,'') || ':' || src.access_type || ':' || src.access_value)::uuid) AS id,
              COALESCE(e.application_id, $2::uuid) AS application_id,
              COALESCE(e.name, src.display_name, src.access_value) AS name,
              COALESCE(e.description, src.display_name) AS description,
              COALESCE(e.type, src.access_type, 'entitlement') AS type,
              COALESCE(e.value, src.access_value) AS value,
              COALESCE((e.metadata->>'requestable')::boolean, false) AS requestable,
              COALESCE((e.metadata->>'owner')::text, '') AS owner,
              COALESCE((e.metadata->>'classification')::text, '') AS classification,
              COALESCE(src.account_count, 0) AS account_count,
              src.last_seen_at,
              e.metadata,
              src.connector_id
         FROM src
         FULL OUTER JOIN entitlements e
           ON e.tenant_id = $1
          AND e.application_id = $2
          AND COALESCE(e.type, '') = COALESCE(src.access_type, e.type, '')
          AND COALESCE(e.value, '') = COALESCE(src.access_value, e.value, '')
        WHERE e.application_id = $2 ${connectorClause}
        ORDER BY COALESCE(e.name, src.display_name, src.access_value)`,
      params
    );

    res.json({ application: app, entitlements: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch application entitlements: ' + err.message });
  }
});

router.delete('/:id', authenticate, auditLog('application.delete'), async (req, res) => {
  const client = await db.connect();
  try {
    if (!(await ensureSuperAdmin(req, res))) return;

    const justification = String(req.body?.justification || '').trim();
    if (!justification) {
      return res.status(400).json({ error: 'Business justification is required' });
    }

    await client.query('BEGIN');

    const appRes = await client.query(`SELECT * FROM applications WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, req.tenantId]);
    if (!appRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found' });
    }
    const app = appRes.rows[0];

    // Resolve connectorId — try stored references first, then fuzzy name match using the client (in-transaction)
    let connectorId = app?.metadata?.connector_id || app?.provisioning_config?.connector_id || null;
    if (connectorId) {
      // Verify it still exists
      const chk = await client.query('SELECT id FROM connectors WHERE id=$1 AND tenant_id=$2', [connectorId, req.tenantId]);
      if (!chk.rows.length) connectorId = null;
    }
    if (!connectorId) {
      // Fuzzy name match
      const parsedMeta = typeof app.metadata === 'string' ? JSON.parse(app.metadata || '{}') : (app.metadata || {});
      const parsedProv = typeof app.provisioning_config === 'string' ? JSON.parse(app.provisioning_config || '{}') : (app.provisioning_config || {});
      const storedId = parsedMeta?.connector_id || parsedProv?.connector_id;
      if (storedId) {
        const chk2 = await client.query('SELECT id FROM connectors WHERE id=$1 AND tenant_id=$2', [storedId, req.tenantId]);
        if (chk2.rows.length) connectorId = chk2.rows[0].id;
      }
      if (!connectorId) {
        const { rows: fuzzy } = await client.query(
          `SELECT c.id FROM connectors c WHERE c.tenant_id=$1 AND (lower(c.name)=lower($2) OR lower(c.name)=lower($3) OR lower(regexp_replace(c.name,' Application$','','i'))=lower(regexp_replace($2,' Application$','','i'))) ORDER BY c.created_at DESC LIMIT 1`,
          [req.tenantId, app.name, app.name.replace(/ Application$/i, '')]
        );
        connectorId = fuzzy[0]?.id || null;
      }
    }

    // Count accounts/entitlements BEFORE deleting (for the report email)
    const acctCount = connectorId
      ? (await client.query(`SELECT COUNT(*)::int AS c FROM account_links WHERE connector_id=$1 AND tenant_id=$2 AND object_type='account'`, [connectorId, req.tenantId])).rows[0]?.c || 0
      : 0;
    const entCount = (await client.query(`SELECT COUNT(*)::int AS c FROM entitlements WHERE application_id=$1 AND tenant_id=$2`, [req.params.id, req.tenantId])).rows[0]?.c || 0;

    // Cascade: delete all connector-linked data
    if (connectorId) {
      // Delete users linked ONLY to this connector — must run BEFORE account_links are deleted
      await client.query(
        `DELETE FROM users u
          WHERE u.tenant_id = $1
            AND EXISTS (
              SELECT 1 FROM account_links al
               WHERE al.user_id = u.id AND al.connector_id = $2 AND al.tenant_id = $1
            )
            AND NOT EXISTS (
              SELECT 1 FROM account_links al2
               WHERE al2.user_id = u.id AND al2.tenant_id = $1 AND al2.connector_id <> $2
            )`,
        [req.tenantId, connectorId]
      );
      await client.query(`DELETE FROM account_access_items WHERE connector_id=$1 AND tenant_id=$2`, [connectorId, req.tenantId]);
      await client.query(`DELETE FROM account_links WHERE connector_id=$1 AND tenant_id=$2`, [connectorId, req.tenantId]);
      await client.query(`DELETE FROM aggregation_jobs WHERE connector_id=$1 AND tenant_id=$2`, [connectorId, req.tenantId]);
      await client.query(`DELETE FROM provisioning_policies WHERE connector_id=$1 AND tenant_id=$2`, [connectorId, req.tenantId]);
      await client.query(`UPDATE provisioning_transactions SET connector_id=NULL WHERE connector_id=$1 AND tenant_id=$2`, [connectorId, req.tenantId]);
      await client.query(`DELETE FROM sync_jobs WHERE connector_id=$1`, [connectorId]);
      await client.query(`DELETE FROM connector_schemas WHERE connector_id=$1`, [connectorId]);
      await client.query(`DELETE FROM schema_custom_attributes WHERE connector_id=$1`, [connectorId]);
      await client.query(`DELETE FROM attribute_mappings WHERE connector_id=$1`, [connectorId]);
    }

    // Cascade: delete entitlements, certifications, access requests, provisioning plans, scim tokens
    await client.query(`DELETE FROM entitlements WHERE application_id=$1 AND tenant_id=$2`, [req.params.id, req.tenantId]);
    await client.query(`DELETE FROM scim_tokens WHERE application_id=$1 AND tenant_id=$2`, [req.params.id, req.tenantId]);

    // Delete cert items referencing this app
    await client.query(
      `DELETE FROM certification_items ci
         USING certifications c
        WHERE ci.certification_id = c.id
          AND c.tenant_id = $1
          AND ci.resource_id = $2`,
      [req.tenantId, req.params.id]
    );

    // Delete access request items referencing this app
    await client.query(
      `DELETE FROM access_requests ar
        WHERE ar.tenant_id = $1
          AND ar.resource_id = $2`,
      [req.tenantId, req.params.id]
    );

    await client.query(`DELETE FROM applications WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenantId]);

    let deletedConnector = false;
    if (connectorId) {
      const otherApps = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM applications
          WHERE tenant_id=$1
            AND id <> $2
            AND COALESCE(metadata->>'connector_id', provisioning_config->>'connector_id') = $3`,
        [req.tenantId, req.params.id, connectorId]
      );
      if ((otherApps.rows[0]?.count || 0) === 0) {
        await client.query(`DELETE FROM connectors WHERE id=$1 AND tenant_id=$2`, [connectorId, req.tenantId]);
        deletedConnector = true;
      }
    }

    await client.query('COMMIT');

    res.json({ success: true, deleted: { id: app.id, name: app.name }, connectorDeleted: deletedConnector, justification });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message || 'Failed to delete application' });
  } finally {
    client.release();
  }
});

module.exports = router;
