const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const { safeJson, getSummary, runRule, simulateWorkflow } = require('../services/platform/StudioService');

router.use(authenticate);

router.get('/summary', async (req, res) => {
  res.json(await getSummary(req.tenantId, req.user.id));
});

router.get('/email/providers', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM email_providers WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.tenantId]);
  res.json(rows);
});

router.post('/email/providers', auditLog('studio.email_provider.upsert'), async (req, res) => {
  const { name, provider_type, from_email, from_name, smtp_host, smtp_port, secure, username, password, is_active, config } = req.body;
  const { rows } = await db.query(
    `INSERT INTO email_providers (tenant_id, name, provider_type, from_email, from_name, smtp_host, smtp_port, secure, username, password_encrypted, is_active, config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.tenantId, name, provider_type || 'smtp', from_email, from_name, smtp_host, smtp_port || 587, !!secure, username, password || null, is_active !== false, JSON.stringify(config || {})]
  );
  res.status(201).json(rows[0]);
});

router.get('/email/templates', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM email_templates WHERE tenant_id=$1 ORDER BY template_key`, [req.tenantId]);
  res.json(rows);
});

router.post('/email/templates', auditLog('studio.email_template.upsert'), async (req, res) => {
  const { template_key, subject, body_html, body_text, variables } = req.body;
  const { rows } = await db.query(
    `INSERT INTO email_templates (tenant_id, template_key, subject, body_html, body_text, variables)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, template_key) DO UPDATE SET subject=EXCLUDED.subject, body_html=EXCLUDED.body_html, body_text=EXCLUDED.body_text, variables=EXCLUDED.variables, updated_at=NOW()
     RETURNING *`,
    [req.tenantId, template_key, subject, body_html, body_text, JSON.stringify(variables || [])]
  );
  res.status(201).json(rows[0]);
});

router.get('/workflows', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM workflow_definitions WHERE tenant_id=$1 ORDER BY updated_at DESC, name`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, steps: safeJson(r.steps, []), trigger_conditions: safeJson(r.trigger_conditions, {}) })));
});

router.post('/workflows', auditLog('studio.workflow.upsert'), async (req, res) => {
  const { id, name, description, category, trigger_type, trigger_conditions, steps, is_active } = req.body;
  let sql, params;
  if (id) {
    sql = `UPDATE workflow_definitions SET name=$3, description=$4, category=$5, trigger_type=$6, trigger_conditions=$7, steps=$8, is_active=$9, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`;
    params = [req.tenantId, id, name, description, category || 'governance', trigger_type || 'manual', JSON.stringify(trigger_conditions || {}), JSON.stringify(steps || []), is_active !== false];
  } else {
    sql = `INSERT INTO workflow_definitions (tenant_id, name, description, category, trigger_type, trigger_conditions, steps, is_active, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`;
    params = [req.tenantId, name, description, category || 'governance', trigger_type || 'manual', JSON.stringify(trigger_conditions || {}), JSON.stringify(steps || []), is_active !== false, req.user.id];
  }
  const { rows } = await db.query(sql, params);
  res.status(201).json(rows[0]);
});

router.post('/workflows/:id/simulate', auditLog('studio.workflow.simulate'), async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM workflow_definitions WHERE tenant_id=$1 AND id=$2`, [req.tenantId, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Workflow not found' });
  const execution = await simulateWorkflow(rows[0], req.body || {});
  const { rows: runRows } = await db.query(
    `INSERT INTO workflow_runs (tenant_id, workflow_id, status, trigger_type, input_payload, execution_log, started_by, completed_at)
     VALUES ($1,$2,'completed','simulation',$3,$4,$5,NOW()) RETURNING *`,
    [req.tenantId, req.params.id, JSON.stringify(req.body || {}), JSON.stringify(execution), req.user.id]
  );
  res.json({ run: runRows[0], execution });
});

router.get('/scripts', async (req, res) => {
  const { rows } = await db.query(`SELECT id, tenant_id, name, description, language, entry_type, enabled, test_input, updated_at, created_at FROM script_definitions WHERE tenant_id=$1 ORDER BY updated_at DESC, name`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, test_input: safeJson(r.test_input, {}) })));
});

router.post('/scripts', auditLog('studio.script.upsert'), async (req, res) => {
  const { id, name, description, language, entry_type, code, test_input, enabled } = req.body;
  let sql, params;
  if (id) {
    sql = `UPDATE script_definitions SET name=$3, description=$4, language=$5, entry_type=$6, code=$7, test_input=$8, enabled=$9, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`;
    params = [req.tenantId, id, name, description, language || 'javascript', entry_type || 'workflow_rule', code, JSON.stringify(test_input || {}), enabled !== false];
  } else {
    sql = `INSERT INTO script_definitions (tenant_id, name, description, language, entry_type, code, test_input, enabled, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`;
    params = [req.tenantId, name, description, language || 'javascript', entry_type || 'workflow_rule', code, JSON.stringify(test_input || {}), enabled !== false, req.user.id];
  }
  const { rows } = await db.query(sql, params);
  res.status(201).json(rows[0]);
});

router.post('/scripts/:id/test', auditLog('studio.script.test'), async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM script_definitions WHERE tenant_id=$1 AND id=$2`, [req.tenantId, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Script not found' });
  const input = req.body?.input || safeJson(rows[0].test_input, {});
  const result = runRule(rows[0].code, { input });
  res.json({ result });
});


router.get('/launchpad', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM quick_links WHERE tenant_id=$1 AND enabled=true ORDER BY sort_order, name`, [req.tenantId]);
    let capSet = new Set();
    try {
      const meCaps = await db.query(`
        WITH role_caps AS (
          SELECT jsonb_array_elements_text(COALESCE(r.metadata->'capabilities','[]'::jsonb)) AS capability_key
          FROM user_roles ur JOIN roles r ON r.id=ur.role_id
          WHERE ur.user_id=$1 AND ur.status='active'
        ), direct_caps AS (
          SELECT capability_key FROM user_capabilities WHERE user_id=$1
        )
        SELECT DISTINCT capability_key FROM (SELECT capability_key FROM role_caps UNION ALL SELECT capability_key FROM direct_caps) x
      `, [req.user.id]);
      capSet = new Set(meCaps.rows.map(r => r.capability_key));
    } catch (_) {
      capSet = new Set(['*']);
    }
    const visible = rows.filter(r => {
      const required = safeJson(r.required_capabilities, []);
      return required.length === 0 || capSet.has('*') || required.every(c => capSet.has(c));
    }).map(r => ({ ...r, config: safeJson(r.config, {}), required_capabilities: safeJson(r.required_capabilities, []) }));
    res.json(visible);
  } catch (err) {
    res.json([]);
  }
});

router.get('/quicklinks', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM quick_links WHERE tenant_id=$1 ORDER BY sort_order, name`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, config: safeJson(r.config, {}) })));
});

router.post('/quicklinks', auditLog('studio.quicklink.upsert'), async (req, res) => {
  const { id, name, icon, route, action_type, workflow_id, visibility_rule, enabled, sort_order, config, required_capabilities } = req.body;
  let sql, params;
  if (id) {
    sql = `UPDATE quick_links SET name=$3, icon=$4, route=$5, action_type=$6, workflow_id=$7, visibility_rule=$8, enabled=$9, sort_order=$10, config=$11, required_capabilities=$12, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`;
    params = [req.tenantId, id, name, icon || 'Zap', route, action_type || 'navigate', workflow_id || null, visibility_rule || null, enabled !== false, sort_order || 100, JSON.stringify(config || {}), JSON.stringify(required_capabilities || [])];
  } else {
    sql = `INSERT INTO quick_links (tenant_id, name, icon, route, action_type, workflow_id, visibility_rule, enabled, sort_order, config, required_capabilities, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`;
    params = [req.tenantId, name, icon || 'Zap', route, action_type || 'navigate', workflow_id || null, visibility_rule || null, enabled !== false, sort_order || 100, JSON.stringify(config || {}), JSON.stringify(required_capabilities || []), req.user.id];
  }
  const { rows } = await db.query(sql, params);
  res.status(201).json(rows[0]);
});

router.get('/work-items', async (req, res) => {
  const { rows } = await db.query(
    `SELECT wi.*, u.first_name || ' ' || u.last_name AS assignee_name, ar.ticket_number, ar.justification
     FROM work_items wi
     LEFT JOIN users u ON u.id = wi.assignee_id
     LEFT JOIN access_requests ar ON ar.id = wi.reference_id
     WHERE wi.tenant_id=$1 ORDER BY wi.created_at DESC`,
    [req.tenantId]
  );
  res.json(rows.map(r => ({ ...r, payload: safeJson(r.payload, {}) })));
});

router.post('/work-items/:id/action', auditLog('studio.work_item.action'), async (req, res) => {
  const { action, comments } = req.body;
  const finalStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'completed';
  const { rows } = await db.query(
    `UPDATE work_items SET status=$3, acted_at=NOW(), acted_by=$4, action_comments=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [req.tenantId, req.params.id, finalStatus, req.user.id, comments || null]
  );
  if (!rows.length) return res.status(404).json({ error: 'Work item not found' });
  res.json(rows[0]);
});

router.get('/task-runs', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM task_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 100`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, input_payload: safeJson(r.input_payload, {}), output_payload: safeJson(r.output_payload, {}), error_detail: safeJson(r.error_detail, null) })));
});

router.get('/provisioning-transactions', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM provisioning_transactions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.tenantId]);
  res.json(rows.map(r => ({ ...r, plan_payload: safeJson(r.plan_payload, {}), connector_response: safeJson(r.connector_response, {}) })));
});

module.exports = router;
