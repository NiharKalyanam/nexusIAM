const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');

// ── List identity attributes ──────────────────────────────────────────────────
router.get('/attributes', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ia.*,
              (SELECT json_agg(
                json_build_object(
                  'id', ism.id, 'priority', ism.priority,
                  'source_application_id', ism.source_application_id,
                  'source_connector_id', ism.source_connector_id,
                  'source_attribute', ism.source_attribute,
                  'app_name', a.name
                ) ORDER BY ism.priority
              )
               FROM identity_source_mappings ism
               LEFT JOIN applications a ON a.id = ism.source_application_id
               WHERE ism.identity_attribute_id = ia.id
              ) AS source_mappings,
              (SELECT json_agg(
                json_build_object(
                  'id', itm.id,
                  'target_application_id', itm.target_application_id,
                  'target_attribute', itm.target_attribute,
                  'transformation_rule', itm.transformation_rule,
                  'provision_all_accounts', itm.provision_all_accounts,
                  'app_name', a2.name
                )
              )
               FROM identity_target_mappings itm
               LEFT JOIN applications a2 ON a2.id = itm.target_application_id
               WHERE itm.identity_attribute_id = ia.id
              ) AS target_mappings
         FROM identity_attributes ia
        WHERE ia.tenant_id = $1
        ORDER BY ia.sort_order, ia.display_name`,
      [req.tenantId]
    );
    res.json({ data: rows });
  } catch (err) {
    console.error('[IDENTITY-MAPPING] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch identity attributes' });
  }
});

// ── Get single attribute ──────────────────────────────────────────────────────
router.get('/attributes/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ia.*,
              (SELECT json_agg(
                json_build_object(
                  'id', ism.id, 'priority', ism.priority,
                  'source_application_id', ism.source_application_id,
                  'source_connector_id', ism.source_connector_id,
                  'source_attribute', ism.source_attribute,
                  'app_name', a.name
                ) ORDER BY ism.priority
              )
               FROM identity_source_mappings ism
               LEFT JOIN applications a ON a.id = ism.source_application_id
               WHERE ism.identity_attribute_id = ia.id
              ) AS source_mappings,
              (SELECT json_agg(
                json_build_object(
                  'id', itm.id,
                  'target_application_id', itm.target_application_id,
                  'target_attribute', itm.target_attribute,
                  'transformation_rule', itm.transformation_rule,
                  'provision_all_accounts', itm.provision_all_accounts,
                  'app_name', a2.name
                )
              )
               FROM identity_target_mappings itm
               LEFT JOIN applications a2 ON a2.id = itm.target_application_id
               WHERE itm.identity_attribute_id = ia.id
              ) AS target_mappings
         FROM identity_attributes ia
        WHERE ia.id = $1 AND ia.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Attribute not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attribute' });
  }
});

// ── Create identity attribute ─────────────────────────────────────────────────
router.post('/attributes', authenticate, auditLog('identity_attribute.create'), async (req, res) => {
  try {
    const { attribute_name, display_name, attribute_type, edit_mode, is_multi_valued } = req.body;
    if (!attribute_name?.trim()) return res.status(400).json({ error: 'attribute_name is required' });

    const { rows } = await db.query(
      `INSERT INTO identity_attributes
         (tenant_id, attribute_name, display_name, attribute_type, edit_mode, is_multi_valued)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.tenantId, attribute_name.trim(),
       display_name || attribute_name.trim(),
       attribute_type || 'string',
       edit_mode || 'editable',
       !!is_multi_valued]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Attribute name already exists' });
    console.error('[IDENTITY-MAPPING] create attr error:', err.message);
    res.status(500).json({ error: 'Failed to create attribute' });
  }
});

// ── Update identity attribute ─────────────────────────────────────────────────
router.put('/attributes/:id', authenticate, auditLog('identity_attribute.update'), async (req, res) => {
  try {
    const { display_name, attribute_type, edit_mode, is_multi_valued } = req.body;
    const { rows } = await db.query(
      `UPDATE identity_attributes
         SET display_name=$1, attribute_type=$2, edit_mode=$3,
             is_multi_valued=$4, updated_at=NOW()
       WHERE id=$5 AND tenant_id=$6 RETURNING *`,
      [display_name, attribute_type || 'string', edit_mode || 'editable',
       !!is_multi_valued, req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Attribute not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update attribute' });
  }
});

// ── Delete identity attribute (non-system only) ───────────────────────────────
router.delete('/attributes/:id', authenticate, auditLog('identity_attribute.delete'), async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT * FROM identity_attributes WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.tenantId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Attribute not found' });
    if (existing.rows[0].is_system) return res.status(400).json({ error: 'System attributes cannot be deleted' });

    await db.query('DELETE FROM identity_attributes WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete attribute' });
  }
});

// ── Save source mappings for an attribute ─────────────────────────────────────
router.put('/attributes/:id/sources', authenticate, auditLog('identity_attribute.sources.update'), async (req, res) => {
  try {
    const { sources } = req.body; // [{source_application_id, source_attribute, priority}]
    if (!Array.isArray(sources)) return res.status(400).json({ error: 'sources must be an array' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM identity_source_mappings WHERE identity_attribute_id=$1',
        [req.params.id]
      );
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        if (!s.source_attribute) continue;
        await client.query(
          `INSERT INTO identity_source_mappings
             (tenant_id, identity_attribute_id, priority, source_application_id, source_connector_id, source_attribute)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.tenantId, req.params.id, i + 1,
           s.source_application_id || null,
           s.source_connector_id || null,
           s.source_attribute]
        );
      }
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[IDENTITY-MAPPING] sources update error:', err.message);
    res.status(500).json({ error: 'Failed to save source mappings' });
  }
});

// ── Save target mappings for an attribute ─────────────────────────────────────
router.put('/attributes/:id/targets', authenticate, auditLog('identity_attribute.targets.update'), async (req, res) => {
  try {
    const { targets } = req.body;
    if (!Array.isArray(targets)) return res.status(400).json({ error: 'targets must be an array' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM identity_target_mappings WHERE identity_attribute_id=$1',
        [req.params.id]
      );
      for (const t of targets) {
        if (!t.target_application_id || !t.target_attribute) continue;
        await client.query(
          `INSERT INTO identity_target_mappings
             (tenant_id, identity_attribute_id, target_application_id, target_attribute,
              transformation_rule, provision_all_accounts)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (identity_attribute_id, target_application_id, target_attribute)
           DO UPDATE SET transformation_rule=EXCLUDED.transformation_rule,
                         provision_all_accounts=EXCLUDED.provision_all_accounts`,
          [req.tenantId, req.params.id, t.target_application_id, t.target_attribute,
           t.transformation_rule || null, !!t.provision_all_accounts]
        );
      }
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[IDENTITY-MAPPING] targets update error:', err.message);
    res.status(500).json({ error: 'Failed to save target mappings' });
  }
});

// ── Global settings (mover fields etc) ───────────────────────────────────────
router.get('/settings/:key', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM global_settings WHERE tenant_id=$1 AND key=$2',
      [req.tenantId, req.params.key]
    );
    res.json(rows[0] || { key: req.params.key, value: null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

router.put('/settings/:key', authenticate, async (req, res) => {
  try {
    const { value } = req.body;
    const { rows } = await db.query(
      `INSERT INTO global_settings (tenant_id, key, value, updated_by)
       VALUES ($1,$2,$3::jsonb,$4)
       ON CONFLICT (tenant_id, key) DO UPDATE
         SET value=$3::jsonb, updated_at=NOW(), updated_by=$4
       RETURNING *`,
      [req.tenantId, req.params.key, JSON.stringify(value), req.userId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

module.exports = router;
