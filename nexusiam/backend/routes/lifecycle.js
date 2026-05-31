
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
router.use(authenticate);

router.get('/', async (req, res) => {
  const defs = await db.query(`SELECT led.*, wd.name AS workflow_name FROM lifecycle_event_definitions led LEFT JOIN workflow_definitions wd ON wd.id=led.workflow_id WHERE led.tenant_id=$1 ORDER BY led.name`, [req.tenantId]);
  const runs = await db.query(`SELECT ler.*, led.name AS event_name, u.first_name || ' ' || u.last_name AS subject_name FROM lifecycle_event_runs ler LEFT JOIN lifecycle_event_definitions led ON led.id=ler.lifecycle_event_id LEFT JOIN users u ON u.id=ler.subject_user_id WHERE ler.tenant_id=$1 ORDER BY ler.created_at DESC LIMIT 30`, [req.tenantId]);
  res.json({ definitions: defs.rows, runs: runs.rows });
});

router.post('/', auditLog('lifecycle.upsert'), async (req, res) => {
  const { id, name, event_key, description, trigger_source, trigger_conditions, workflow_id, form_definition_id, config, enabled } = req.body;
  let q, p;
  if (id) {
    q = `UPDATE lifecycle_event_definitions SET name=$3,event_key=$4,description=$5,trigger_source=$6,trigger_conditions=$7,workflow_id=$8,form_definition_id=$9,config=$10,enabled=$11,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`;
    p = [req.tenantId, id, name, event_key, description, trigger_source || 'identity_change', JSON.stringify(trigger_conditions||{}), workflow_id || null, form_definition_id || null, JSON.stringify(config||{}), enabled !== false];
  } else {
    q = `INSERT INTO lifecycle_event_definitions (tenant_id,name,event_key,description,trigger_source,trigger_conditions,workflow_id,form_definition_id,config,enabled,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`;
    p = [req.tenantId, name, event_key, description, trigger_source || 'identity_change', JSON.stringify(trigger_conditions||{}), workflow_id || null, form_definition_id || null, JSON.stringify(config||{}), enabled !== false, req.user.id];
  }
  const out = await db.query(q,p);
  res.status(201).json(out.rows[0]);
});



router.post('/evaluate', async (req, res) => {
  const { previous = {}, current = {} } = req.body || {};
  const prevStatus = String(previous.status || previous.worker_status || '').toLowerCase();
  const currStatus = String(current.status || current.worker_status || '').toLowerCase();
  const prevExists = !!(previous.id || previous.employee_id || previous.email);
  const currExists = !!(current.id || current.employee_id || current.email);
  const previousTerminated = ['inactive','terminated','leaver','disabled'].includes(prevStatus);
  const currentTerminated = ['inactive','terminated','leaver','disabled'].includes(currStatus);

  let event_key = 'none';
  if (!prevExists && currExists && !currentTerminated) event_key = 'joiner';
  else if (previousTerminated && currExists && !currentTerminated) event_key = 'rehire';
  else if (!previousTerminated && currentTerminated) event_key = 'leaver';
  else if (prevExists && currExists) {
    const moved = ['department','title','manager','location','org_id'].some(k => (previous[k] || '') !== (current[k] || ''));
    if (moved) event_key = 'mover';
    else if (String(current.employment_type || '').toLowerCase() === 'ncd') event_key = 'ncd';
  }

  const defs = event_key === 'none' ? [] : await db.query(`SELECT led.*, wd.name AS workflow_name FROM lifecycle_event_definitions led LEFT JOIN workflow_definitions wd ON wd.id=led.workflow_id WHERE led.tenant_id=$1 AND led.enabled=true AND led.event_key=$2 ORDER BY led.name`, [req.tenantId, event_key]);
  res.json({ event_key, matchedDefinitions: defs.rows || [], explanation: {
    joiner: 'New HR identity with active status',
    rehire: 'Previously inactive identity became active again',
    leaver: 'Previously active identity is now inactive/terminated',
    mover: 'Identity stayed active but key attributes changed',
    ncd: 'Non-employee / NCD style identity change',
    none: 'No lifecycle transition detected',
  }[event_key] });
});

router.post('/:id/run', auditLog('lifecycle.run'), async (req, res) => {
  const { subject_user_id, payload } = req.body || {};
  const defs = await db.query(`SELECT * FROM lifecycle_event_definitions WHERE tenant_id=$1 AND id=$2`, [req.tenantId, req.params.id]);
  if (!defs.rows.length) return res.status(404).json({ error: 'Lifecycle event not found' });
  const event = defs.rows[0];
  const output = {
    event: event.event_key,
    actions: event.event_key === 'leaver' ? ['revoke_roles','disable_accounts','notify_manager'] : ['assign_birthright','launch_workflow','notify_manager'],
    workflow_id: event.workflow_id,
    mode: 'simulation-ready',
  };
  const run = await db.query(`INSERT INTO lifecycle_event_runs (tenant_id,lifecycle_event_id,subject_user_id,status,input_payload,output_payload,triggered_by) VALUES ($1,$2,$3,'completed',$4,$5,$6) RETURNING *`, [req.tenantId, req.params.id, subject_user_id || null, JSON.stringify(payload||{}), JSON.stringify(output), req.user.id]);
  res.json({ run: run.rows[0], output });
});

module.exports = router;
