const vm = require('vm');
const db = require('../../config/database');

function safeJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function getSummary(tenantId, userId) {
  const queries = {
    workflows: `SELECT COUNT(*)::int AS count FROM workflow_definitions WHERE tenant_id=$1`,
    scripts: `SELECT COUNT(*)::int AS count FROM script_definitions WHERE tenant_id=$1`,
    quicklinks: `SELECT COUNT(*)::int AS count FROM quick_links WHERE tenant_id=$1`,
    providers: `SELECT COUNT(*)::int AS count FROM email_providers WHERE tenant_id=$1`,
    tasks: `SELECT COUNT(*)::int AS count FROM task_runs WHERE tenant_id=$1`,
    provisioning: `SELECT COUNT(*)::int AS count FROM provisioning_transactions WHERE tenant_id=$1`,
    workItems: `SELECT COUNT(*)::int AS count FROM work_items WHERE tenant_id=$1 AND status='pending'`,
    myApprovals: `SELECT COUNT(*)::int AS count FROM work_items WHERE tenant_id=$1 AND assignee_id=$2 AND status='pending'`,
  };

  const result = {};
  for (const [key, sql] of Object.entries(queries)) {
    const params = key === 'myApprovals' ? [tenantId, userId] : [tenantId];
    const { rows } = await db.query(sql, params);
    result[key] = rows[0]?.count || 0;
  }
  return result;
}

function runRule(code, context = {}) {
  const sandbox = {
    input: context.input || {},
    request: context.request || {},
    identity: context.identity || {},
    result: null,
    console: { log: () => {} },
  };
  vm.createContext(sandbox);
  const wrapped = `result = (function(){ ${code}\n})();`;
  new vm.Script(wrapped).runInContext(sandbox, { timeout: 1000 });
  return sandbox.result;
}

async function simulateWorkflow(workflow, payload = {}) {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : safeJson(workflow.steps, []);
  const execution = [];
  for (const step of steps) {
    const entry = {
      name: step.name || step.type,
      type: step.type,
      status: 'completed',
      output: {},
    };
    switch (step.type) {
      case 'APPROVAL':
        entry.output = { assigneeType: step.assigneeType || 'role', assigneeValue: step.assigneeValue || 'IAM Admin', createdWorkItem: true };
        break;
      case 'SEND_EMAIL':
        entry.output = { template: step.template || 'default', recipientMode: step.recipientMode || 'requester', queued: true };
        break;
      case 'RUN_SCRIPT': {
        const { rows } = await db.query(
          `SELECT code, name FROM script_definitions WHERE tenant_id=$1 AND id=$2`,
          [workflow.tenant_id, step.scriptId]
        );
        if (!rows.length) {
          entry.status = 'failed';
          entry.output = { error: 'Script not found' };
        } else {
          entry.output = { script: rows[0].name, result: runRule(rows[0].code, { input: payload }) };
        }
        break;
      }
      case 'PROVISION':
        entry.output = { operation: step.operation || 'assign_access', queuedTransaction: true };
        break;
      default:
        entry.output = { message: 'Generic step executed' };
        break;
    }
    execution.push(entry);
  }
  return execution;
}

module.exports = {
  safeJson,
  getSummary,
  runRule,
  simulateWorkflow,
};
