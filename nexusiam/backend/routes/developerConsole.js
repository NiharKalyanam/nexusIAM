const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const { safeJson, runRule } = require('../services/platform/StudioService');

router.use(authenticate);

router.get('/summary', async (req, res) => {
  const queries = {
    forms: `SELECT COUNT(*)::int AS count FROM form_definitions WHERE tenant_id=$1`,
    uiPages: `SELECT COUNT(*)::int AS count FROM ui_page_definitions WHERE tenant_id=$1`,
    plugins: `SELECT COUNT(*)::int AS count FROM plugin_registry WHERE tenant_id=$1`,
    loggers: `SELECT COUNT(*)::int AS count FROM logger_configs WHERE tenant_id=$1`,
    hooks: `SELECT COUNT(*)::int AS count FROM extension_hooks WHERE tenant_id=$1`,
  };
  const out = {};
  for (const [k, sql] of Object.entries(queries)) {
    const { rows } = await db.query(sql, [req.tenantId]);
    out[k] = rows[0]?.count || 0;
  }
  res.json(out);
});

router.get('/forms', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM form_definitions WHERE tenant_id=$1 ORDER BY updated_at DESC, name`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, schema: safeJson(r.schema, {}), ui_schema: safeJson(r.ui_schema, {}), validation_rules: safeJson(r.validation_rules, []) })));
});

router.post('/forms', auditLog('developer.form.upsert'), async (req, res) => {
  const { id, name, description, category, schema, ui_schema, validation_rules, enabled } = req.body;
  const sql = id
    ? `UPDATE form_definitions SET name=$3, description=$4, category=$5, schema=$6, ui_schema=$7, validation_rules=$8, enabled=$9, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`
    : `INSERT INTO form_definitions (tenant_id, name, description, category, schema, ui_schema, validation_rules, enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`;
  const params = id
    ? [req.tenantId, id, name, description, category || 'request', JSON.stringify(schema || {}), JSON.stringify(ui_schema || {}), JSON.stringify(validation_rules || []), enabled !== false]
    : [req.tenantId, name, description, category || 'request', JSON.stringify(schema || {}), JSON.stringify(ui_schema || {}), JSON.stringify(validation_rules || []), enabled !== false, req.user.id];
  const { rows } = await db.query(sql, params);
  res.status(201).json(rows[0]);
});

router.get('/ui-pages', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM ui_page_definitions WHERE tenant_id=$1 ORDER BY updated_at DESC, name`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, page_config: safeJson(r.page_config, {}) })));
});

router.post('/ui-pages', auditLog('developer.ui_page.upsert'), async (req, res) => {
  const { id, name, route_path, title, description, icon, page_type, page_config, required_permissions, enabled } = req.body;
  const sql = id
    ? `UPDATE ui_page_definitions SET name=$3, route_path=$4, title=$5, description=$6, icon=$7, page_type=$8, page_config=$9, required_permissions=$10, enabled=$11, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`
    : `INSERT INTO ui_page_definitions (tenant_id, name, route_path, title, description, icon, page_type, page_config, required_permissions, enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`;
  const params = id
    ? [req.tenantId, id, name, route_path, title, description, icon || 'Layout', page_type || 'custom', JSON.stringify(page_config || {}), JSON.stringify(required_permissions || []), enabled !== false]
    : [req.tenantId, name, route_path, title, description, icon || 'Layout', page_type || 'custom', JSON.stringify(page_config || {}), JSON.stringify(required_permissions || []), enabled !== false, req.user.id];
  const { rows } = await db.query(sql, params);
  res.status(201).json(rows[0]);
});

router.get('/plugins', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM plugin_registry WHERE tenant_id=$1 ORDER BY updated_at DESC, name`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, manifest: safeJson(r.manifest, {}), capabilities: safeJson(r.capabilities, []), routes: safeJson(r.routes, []), extension_points: safeJson(r.extension_points, []) })));
});

router.post('/plugins', auditLog('developer.plugin.upsert'), async (req, res) => {
  const { id, name, version, status, package_type, manifest, capabilities, routes, extension_points, enabled } = req.body;
  const sql = id
    ? `UPDATE plugin_registry SET name=$3, version=$4, status=$5, package_type=$6, manifest=$7, capabilities=$8, routes=$9, extension_points=$10, enabled=$11, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`
    : `INSERT INTO plugin_registry (tenant_id, name, version, status, package_type, manifest, capabilities, routes, extension_points, enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`;
  const params = id
    ? [req.tenantId, id, name, version || '1.0.0', status || 'draft', package_type || 'metadata', JSON.stringify(manifest || {}), JSON.stringify(capabilities || []), JSON.stringify(routes || []), JSON.stringify(extension_points || []), enabled !== false]
    : [req.tenantId, name, version || '1.0.0', status || 'draft', package_type || 'metadata', JSON.stringify(manifest || {}), JSON.stringify(capabilities || []), JSON.stringify(routes || []), JSON.stringify(extension_points || []), enabled !== false, req.user.id];
  const { rows } = await db.query(sql, params);
  res.status(201).json(rows[0]);
});

router.get('/loggers', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM logger_configs WHERE tenant_id=$1 ORDER BY updated_at DESC, logger_name`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, config: safeJson(r.config, {}) })));
});

router.post('/loggers', auditLog('developer.logger.upsert'), async (req, res) => {
  const { id, logger_name, level, target_type, pattern, enabled, config } = req.body;
  const sql = id
    ? `UPDATE logger_configs SET logger_name=$3, level=$4, target_type=$5, pattern=$6, enabled=$7, config=$8, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`
    : `INSERT INTO logger_configs (tenant_id, logger_name, level, target_type, pattern, enabled, config, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;
  const params = id
    ? [req.tenantId, id, logger_name, level || 'info', target_type || 'application', pattern || '%timestamp% %level% %message%', enabled !== false, JSON.stringify(config || {})]
    : [req.tenantId, logger_name, level || 'info', target_type || 'application', pattern || '%timestamp% %level% %message%', enabled !== false, JSON.stringify(config || {}), req.user.id];
  const { rows } = await db.query(sql, params);
  res.status(201).json(rows[0]);
});

router.get('/hooks', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM extension_hooks WHERE tenant_id=$1 ORDER BY hook_key`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, config: safeJson(r.config, {}) })));
});

router.post('/hooks', auditLog('developer.hook.upsert'), async (req, res) => {
  const { id, hook_key, hook_type, script_id, plugin_id, execution_mode, enabled, config } = req.body;
  const sql = id
    ? `UPDATE extension_hooks SET hook_key=$3, hook_type=$4, script_id=$5, plugin_id=$6, execution_mode=$7, enabled=$8, config=$9, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`
    : `INSERT INTO extension_hooks (tenant_id, hook_key, hook_type, script_id, plugin_id, execution_mode, enabled, config, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`;
  const params = id
    ? [req.tenantId, id, hook_key, hook_type || 'workflow_step', script_id || null, plugin_id || null, execution_mode || 'sync', enabled !== false, JSON.stringify(config || {})]
    : [req.tenantId, hook_key, hook_type || 'workflow_step', script_id || null, plugin_id || null, execution_mode || 'sync', enabled !== false, JSON.stringify(config || {}), req.user.id];
  const { rows } = await db.query(sql, params);
  res.status(201).json(rows[0]);
});

router.post('/script-console/execute', auditLog('developer.script_console.execute'), async (req, res) => {
  const { code, input } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  try {
    const result = runRule(code, { input: input || {} });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
