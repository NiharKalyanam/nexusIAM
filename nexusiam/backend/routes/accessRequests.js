const express = require('express');
const router = express.Router();
const db     = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const EmailService = require('../services/email/EmailService');
const ProvisioningEngine = require('../services/provisioning/ProvisioningEngine');
const logger = require('../config/logger');

function generateTicketNumber() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `REQ-${ts}-${rand}`;
}

async function getUser(id) {
  if (!id) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [id]);
  return rows[0] || null;
}

// Get approvers: manager of target user, fallback to settings fallback, then Super Admin
async function getApprovers(tenantId, targetUserId) {
  const approvers = [];

  // 1. Try manager of target user
  if (targetUserId) {
    const { rows } = await db.query(
      `SELECT u.* FROM users u
       JOIN users t ON t.manager_id = u.id
       WHERE t.id = $1 AND u.status = 'active'`,
      [targetUserId]
    );
    if (rows.length) { approvers.push(...rows); return approvers; }
  }

  // 2. Try fallback approver from settings
  const { rows: settingsRows } = await db.query(
    `SELECT fallback_approver_id, fallback_approver_type FROM access_request_settings WHERE tenant_id=$1`,
    [tenantId]
  );
  const settings = settingsRows[0];

  if (settings?.fallback_approver_id) {
    if (settings.fallback_approver_type === 'workgroup') {
      // Get all members of the workgroup
      const { rows: wgMembers } = await db.query(
        `SELECT u.* FROM workgroup_members wm
         JOIN users u ON u.id = wm.user_id
         WHERE wm.workgroup_id = $1 AND u.status = 'active'`,
        [settings.fallback_approver_id]
      );
      if (wgMembers.length) { approvers.push(...wgMembers); return approvers; }
    } else {
      const user = await getUser(settings.fallback_approver_id);
      if (user) { approvers.push(user); return approvers; }
    }
  }

  // 3. Final fallback: Super Admin users
  const { rows: admins } = await db.query(
    `SELECT DISTINCT u.* FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name IN ('Super Admin','IAM Admin') AND ur.tenant_id=$1 AND u.status='active'
     LIMIT 3`,
    [tenantId]
  );
  approvers.push(...admins);
  return approvers;
}

async function getRoleName(roleId) {
  if (!roleId) return null;
  const { rows } = await db.query('SELECT name FROM roles WHERE id=$1', [roleId]);
  return rows[0]?.name;
}

async function getConnectors(tenantId) {
  const { rows } = await db.query("SELECT * FROM connectors WHERE tenant_id=$1 AND status='connected'", [tenantId]);
  return rows;
}

async function getRelevantConnectorsForRequest(tenantId, reqData) {
  if (reqData.request_type === 'entitlement_grant' && reqData.resource_id) {
    const { rows } = await db.query(
      `SELECT c.*, e.id AS entitlement_id, e.name AS entitlement_name, e.value AS entitlement_value
         FROM entitlements e
         LEFT JOIN applications a ON a.id = e.application_id
         JOIN connectors c ON c.tenant_id = e.tenant_id
          AND c.id::text = COALESCE(e.metadata->>'connector_id', a.metadata->>'connector_id', a.provisioning_config->>'connector_id')
        WHERE e.id=$1 AND e.tenant_id=$2`,
      [reqData.resource_id, tenantId]
    );
    return rows;
  }
  if (reqData.request_type === 'role_grant' && reqData.resource_id) {
    // Get all entitlements from this role AND all child IT roles (via role_inheritance)
    const { rows } = await db.query(
      `SELECT DISTINCT c.*, e.id AS entitlement_id, e.name AS entitlement_name, e.value AS entitlement_value
         FROM (
           -- Direct entitlements on this role
           SELECT re.entitlement_id FROM role_entitlements re WHERE re.role_id=$1
           UNION
           -- Entitlements from child IT roles (Business Role -> IT Role -> Entitlements)
           SELECT re2.entitlement_id FROM role_inheritance ri
           JOIN role_entitlements re2 ON re2.role_id = ri.child_role_id
           WHERE ri.parent_role_id=$1 AND ri.tenant_id=$2
         ) all_ents
         JOIN entitlements e ON e.id = all_ents.entitlement_id AND e.tenant_id=$2
         LEFT JOIN applications a ON a.id = e.application_id
         JOIN connectors c ON c.tenant_id = e.tenant_id
          AND c.id::text = COALESCE(e.metadata->>'connector_id', a.metadata->>'connector_id', a.provisioning_config->>'connector_id')`,
      [reqData.resource_id, tenantId]
    ).catch(() => ({ rows: [] }));
    return rows;
  }
  return [];
}

// ── GET catalog ───────────────────────────────────────────────────────────────
router.get('/catalog', authenticate, async (req, res) => {
  try {
    let users = [], roles = [], applications = [], entitlements = [], managers = [], departments = [];

    try {
      const r = await db.query(
        `SELECT u.id, u.username, u.email, u.department, u.title, u.status, u.location,
                COALESCE(u.display_name, u.first_name||' '||u.last_name, u.username) AS display_name,
                m.id AS manager_id,
                COALESCE(m.display_name, m.first_name||' '||m.last_name, m.username) AS manager_name
         FROM users u LEFT JOIN users m ON m.id = u.manager_id
         WHERE u.tenant_id=$1 AND u.status='active'
         ORDER BY COALESCE(u.display_name, u.username)`,
        [req.tenantId]
      );
      users = r.rows;
    } catch(e) { logger.warn('catalog users failed', { error: e.message }); }

    try {
      const r = await db.query(`SELECT id, name, description, type, risk_level FROM roles WHERE tenant_id=$1 ORDER BY type, name`, [req.tenantId]);
      roles = r.rows;
    } catch(e) { logger.warn('catalog roles failed', { error: e.message }); }

    try {
      const r = await db.query(`SELECT id, name, type FROM applications WHERE tenant_id=$1 ORDER BY name`, [req.tenantId]);
      applications = r.rows;
    } catch(e) { logger.warn('catalog apps failed', { error: e.message }); }

    try {
      const r = await db.query(
        `SELECT e.id, e.name, e.type, e.value, e.description,
                COALESCE(e.display_value, e.name, e.value) AS display_name,
                COALESCE(a.name, a2.name) AS application_name,
                COALESCE(a.id, a2.id) AS application_id
         FROM entitlements e
         LEFT JOIN applications a ON a.id = e.application_id AND a.tenant_id = e.tenant_id
         LEFT JOIN account_access_items aai ON aai.access_type = e.type AND aai.access_value = e.value AND aai.tenant_id = e.tenant_id
         LEFT JOIN applications a2 ON (
           a2.tenant_id = e.tenant_id
           AND a.id IS NULL
           AND (
             COALESCE(a2.metadata->>'connector_id', a2.provisioning_config->>'connector_id') = aai.connector_id::text
           )
         )
         WHERE e.tenant_id=$1
           AND COALESCE((e.metadata->>'requestable')::boolean, true) = true
         GROUP BY e.id, e.name, e.type, e.value, e.description, e.display_value, a.name, a.id, a2.name, a2.id
         ORDER BY COALESCE(a.name, a2.name) NULLS LAST, COALESCE(e.display_value, e.name, e.value) LIMIT 500`,
        [req.tenantId]
      );
      entitlements = r.rows;
    } catch(e) { logger.warn('catalog entitlements failed', { error: e.message }); }

    managers    = [...new Map(users.filter(u=>u.manager_id).map(u=>[u.manager_id,{id:u.manager_id,name:u.manager_name}])).values()];
    departments = [...new Set(users.map(u=>u.department).filter(Boolean))].sort();

    res.json({ users, roles, applications, entitlements, managers, departments });
  } catch(err) {
    logger.error('catalog failed', { error: err.message });
    res.status(500).json({ error: 'Failed to load catalog: ' + err.message });
  }
});

// ── GET all requests ──────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, page=1, limit=15, my_requests } = req.query;
    const offset = (page-1)*limit;
    let where = 'WHERE ar.tenant_id=$1';
    const params = [req.tenantId];
    let idx = 2;
    if (status) { where += ` AND ar.status=$${idx++}`; params.push(status); }
    if (my_requests==='true') { where += ` AND (ar.requester_id=$${idx} OR ar.target_user_id=$${idx})`; params.push(req.user.id); idx++; }

    const count = await db.query(`SELECT COUNT(*) FROM access_requests ar ${where}`, params);
    const { rows } = await db.query(
      `SELECT ar.*,
        COALESCE(u1.display_name, u1.first_name||' '||u1.last_name, u1.username) AS requester_name,
        u1.email AS requester_email, u1.username AS requester_username,
        COALESCE(u2.display_name, u2.first_name||' '||u2.last_name, u2.username) AS target_name,
        u2.email AS target_email, u2.username AS target_username,
        r.name AS role_name,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN SUM(CASE WHEN pt.status IN ('failed','manual_required') THEN 1 ELSE 0 END) > 0
                 AND SUM(CASE WHEN pt.status IN ('success','successful','completed') THEN 1 ELSE 0 END) = 0 THEN 'failed'
            WHEN SUM(CASE WHEN pt.status IN ('failed','manual_required') THEN 1 ELSE 0 END) > 0
                 AND SUM(CASE WHEN pt.status IN ('success','successful','completed') THEN 1 ELSE 0 END) > 0 THEN 'partial_success'
            WHEN SUM(CASE WHEN pt.status IN ('queued','running','in_progress') THEN 1 ELSE 0 END) > 0 THEN 'in_progress'
            WHEN SUM(CASE WHEN pt.status IN ('success','successful','completed') THEN 1 ELSE 0 END) > 0 THEN 'success'
            ELSE NULL
          END
          FROM provisioning_transactions pt
          WHERE pt.request_id = ar.id
        ) AS provisioning_status
       FROM access_requests ar
       LEFT JOIN users u1 ON u1.id=ar.requester_id
       LEFT JOIN users u2 ON u2.id=ar.target_user_id
       LEFT JOIN roles r ON r.id=ar.resource_id
       ${where} ORDER BY ar.requested_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );
    res.json({ data: rows, total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch(err) {
    logger.error('GET /access-requests failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// ── GET my pending approvals (work items) ──────────────────────────────────────
router.get('/my/approvals', authenticate, async (req, res) => {
  try {
    const { page=1, limit=15 } = req.query;
    const offset = (page-1)*limit;

    const { rows } = await db.query(
      `SELECT wi.*,
        ar.ticket_number, ar.request_type, ar.resource_name, ar.justification, ar.priority, ar.requested_at, ar.status AS request_status,
        COALESCE(u1.display_name, u1.first_name||' '||u1.last_name, u1.username) AS requester_name, u1.email AS requester_email,
        COALESCE(u2.display_name, u2.first_name||' '||u2.last_name, u2.username) AS target_name
       FROM work_items wi
       JOIN access_requests ar ON ar.id=wi.reference_id
       LEFT JOIN users u1 ON u1.id=ar.requester_id
       LEFT JOIN users u2 ON u2.id=ar.target_user_id
       WHERE wi.tenant_id=$1 AND wi.assignee_id=$2 AND wi.type='approval' AND wi.status='pending'
       ORDER BY wi.due_at ASC
       LIMIT $3 OFFSET $4`,
      [req.tenantId, req.user.id, limit, offset]
    );
    const count = await db.query(
      `SELECT COUNT(*) FROM work_items WHERE tenant_id=$1 AND assignee_id=$2 AND type='approval' AND status='pending'`,
      [req.tenantId, req.user.id]
    );
    res.json({ data: rows, total: parseInt(count.rows[0].count) });
  } catch(err) {
    res.status(500).json({ error: 'Failed to load approvals: ' + err.message });
  }
});

module.exports

// ── GET single request ────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ar.*,
        COALESCE(u1.display_name, u1.first_name||' '||u1.last_name, u1.username) AS requester_name,
        u1.email AS requester_email,
        COALESCE(u2.display_name, u2.first_name||' '||u2.last_name, u2.username) AS target_name,
        u2.email AS target_email,
        r.name AS role_name,
        COALESCE(ua3.display_name, ua3.first_name||' '||ua3.last_name, ua3.username) AS resolved_by_name
       FROM access_requests ar
       LEFT JOIN users u1 ON u1.id=ar.requester_id
       LEFT JOIN users u2 ON u2.id=ar.target_user_id
       LEFT JOIN roles r ON r.id=ar.resource_id
       LEFT JOIN users ua3 ON ua3.id=ar.resolved_by
       WHERE ar.id=$1 AND ar.tenant_id=$2`,
      [req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const request = rows[0];

    // Get provisioning transactions
    const { rows: provRows } = await db.query(
      `SELECT pt.*, c.name as connector_name, c.type as connector_type, pt.plan_payload
       FROM provisioning_transactions pt
       LEFT JOIN connectors c ON c.id=pt.connector_id
       WHERE pt.request_id=$1 ORDER BY pt.created_at`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));
    request.provisioning_transactions = provRows;

    // Get work items (approval history)
    const { rows: workItems } = await db.query(
      `SELECT wi.*,
        COALESCE(u.display_name, u.first_name||' '||u.last_name, u.username) AS assignee_name
       FROM work_items wi
       LEFT JOIN users u ON u.id=wi.assignee_id
       WHERE wi.reference_id=$1 AND wi.type='approval'
       ORDER BY wi.created_at`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));
    request.work_items = workItems;

    res.json(request);
  } catch(err) {
    res.status(500).json({ error: 'Failed to fetch request: ' + err.message });
  }
});


// ── POST create request ───────────────────────────────────────────────────────
router.post('/', authenticate, auditLog('access_request.create'), async (req, res) => {
  try {
    const { target_user_id, request_type, resource_type, resource_id, justification, priority, duration_days, resource_name } = req.body;
    if (!request_type || !justification) return res.status(400).json({ error: 'request_type and justification required' });

    const ticketNumber = generateTicketNumber();
    const expiresAt = duration_days ? new Date(Date.now() + duration_days*86400000) : null;

    const { rows } = await db.query(
      `INSERT INTO access_requests (tenant_id, ticket_number, requester_id, target_user_id, request_type, resource_type, resource_id, resource_name, justification, priority, duration_days, expires_at, requested_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,
      [req.tenantId, ticketNumber, req.user.id, target_user_id||req.user.id, request_type, resource_type, resource_id, resource_name, justification, priority||'medium', duration_days, expiresAt]
    );
    const request = rows[0];

    // In-app notification for requester
    await db.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, message, link)
       VALUES ($1,$2,'request_submitted','Access Request Submitted',$3,$4)`,
      [req.tenantId, req.user.id, `Request ${ticketNumber} submitted for ${resource_name||'access'}`, `/access-requests`]
    ).catch(()=>{});

    // Create work items for approvers
    const approvers = await getApprovers(req.tenantId, target_user_id||req.user.id);
    for (const approver of approvers) {
      await db.query(
        `INSERT INTO work_items (tenant_id, type, title, assignee_id, reference_type, reference_id, status, due_at, payload)
         VALUES ($1,'approval',$2,$3,'access_request',$4,'pending',NOW()+INTERVAL '${req.body.escalation_days||5} days',$5::jsonb)`,
        [req.tenantId, `Approve: ${resource_name||request_type} for ${target_user_id||'user'}`, approver.id, request.id, JSON.stringify({ ticketNumber, requestType: request_type, resourceName: resource_name, justification, priority: priority||'medium' })]
      ).catch(()=>{});

      // Notification for approver
      await db.query(
        `INSERT INTO notifications (tenant_id, user_id, type, title, message, link)
         VALUES ($1,$2,'approval_required','Approval Required',$3,$4)`,
        [req.tenantId, approver.id, `${ticketNumber}: ${resource_name||request_type} requires your approval`, `/approvals`]
      ).catch(()=>{});
    }

    // Emails
    const requester = await getUser(req.user.id);
    const targetUser = target_user_id && target_user_id!==req.user.id ? await getUser(target_user_id) : null;
    EmailService.sendRequestSubmitted({ request: {...request, created_at: new Date()}, requester }).catch(()=>{});
    for (const approver of approvers) {
      EmailService.sendApprovalRequired({ request, requester, targetUser, approver, stepName:'Initial Approval' }).catch(()=>{});
    }

    res.status(201).json(request);
  } catch(err) {
    logger.error('POST /access-requests failed', { error: err.message });
    res.status(500).json({ error: 'Failed to submit request: ' + err.message });
  }
});

// ── POST action (approve/reject/cancel/forward/reassign) ──────────────────────
router.post('/:id/action', authenticate, auditLog('access_request.action'), async (req, res) => {
  try {
    const { action, comments, forward_to_id, forward_to_type } = req.body;
    const validActions = ['approved','rejected','cancelled','forwarded','reassigned'];
    if (!validActions.includes(action)) return res.status(400).json({ error: 'Invalid action' });

    // Comments required for reject/cancel/forward/reassign
    if (['rejected','cancelled','forwarded','reassigned'].includes(action) && !comments) {
      return res.status(400).json({ error: 'Business justification required for this action' });
    }

    const { rows: reqRows } = await db.query(
      `SELECT ar.*,
        COALESCE(u1.display_name, u1.first_name||' '||u1.last_name) AS requester_name, u1.email AS requester_email,
        COALESCE(u2.display_name, u2.first_name||' '||u2.last_name) AS target_name
       FROM access_requests ar
       LEFT JOIN users u1 ON u1.id=ar.requester_id
       LEFT JOIN users u2 ON u2.id=ar.target_user_id
       WHERE ar.id=$1 AND ar.tenant_id=$2`,
      [req.params.id, req.tenantId]
    );
    if (!reqRows.length) return res.status(404).json({ error: 'Not found' });
    const reqData = reqRows[0];
    const actingUser = await getUser(req.user.id);
    const requester = await getUser(reqData.requester_id);

    if (action === 'forwarded' || action === 'reassigned') {
      if (!forward_to_id) return res.status(400).json({ error: 'forward_to_id required' });

      let newApprovers = [];
      if (forward_to_type === 'workgroup') {
        const { rows } = await db.query(
          `SELECT u.* FROM workgroup_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workgroup_id=$1 AND u.status='active'`,
          [forward_to_id]
        );
        if (!rows.length) {
          // Workgroup empty - use fallback
          newApprovers = await getApprovers(req.tenantId, reqData.target_user_id);
        } else {
          newApprovers = rows;
        }
      } else {
        const user = await getUser(forward_to_id);
        if (user) newApprovers = [user];
      }

      // Close existing work items
      await db.query(
        `UPDATE work_items SET status='forwarded', acted_at=NOW(), acted_by=$3, action_comments=$4
         WHERE tenant_id=$1 AND reference_id=$2 AND status='pending'`,
        [req.tenantId, req.params.id, req.user.id, comments]
      );

      // Create new work items
      for (const approver of newApprovers) {
        await db.query(
          `INSERT INTO work_items (tenant_id, type, title, assignee_id, reference_type, reference_id, status, due_at, payload)
           VALUES ($1,'approval',$2,$3,'access_request',$4,'pending',NOW()+INTERVAL '5 days',$5::jsonb)`,
          [req.tenantId, `Approval needed: ${reqData.resource_name}`, approver.id, req.params.id, JSON.stringify({ ticketNumber: reqData.ticket_number, forwardedBy: actingUser.id, reason: comments })]
        );
        await db.query(
          `INSERT INTO notifications (tenant_id, user_id, type, title, message, link) VALUES ($1,$2,'approval_required','Approval Forwarded To You',$3,$4)`,
          [req.tenantId, approver.id, `${reqData.ticket_number} was ${action} to you by ${actingUser.first_name} ${actingUser.last_name}: ${comments}`, `/approvals`]
        ).catch(()=>{});
        const toUser = await getUser(approver.id);
        // Send forward email to all new approvers
        for (const approver of newApprovers) {
          const toApproverUser = await getUser(approver.id);
          if (toApproverUser) EmailService.sendRequestForwarded({ request: reqData, fromApprover: actingUser, toApprover: toApproverUser, reason: comments }).catch(()=>{});
        }
        // Also notify requester about the forward
        const fwdRequester = await getUser(reqData.requester_id);
        if (fwdRequester && fwdRequester.id !== actingUser.id) {
          await db.query(`INSERT INTO notifications (tenant_id, user_id, type, title, message) VALUES ($1,$2,'request_forwarded','Request Forwarded',$3)`,
            [req.tenantId, reqData.requester_id, `Your request ${reqData.ticket_number} was ${action} by ${actingUser.first_name} ${actingUser.last_name}: ${comments}`]).catch(()=>{});
        }
      }

      // Update notes
      await db.query(`UPDATE access_requests SET resolution_notes=$1, updated_at=NOW() WHERE id=$2`, [`${action} to ${forward_to_id} by ${actingUser.first_name}: ${comments}`, req.params.id]);

      return res.json({ message: `Request ${action}` });
    }

    // Cancel - only requester can cancel
    if (action === 'cancelled') {
      await db.query(
        `UPDATE access_requests SET status='cancelled', resolved_at=NOW(), resolved_by=$1, resolution_notes=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4`,
        [req.user.id, comments, req.params.id, req.tenantId]
      );
      await db.query(
        `UPDATE work_items SET status='cancelled', acted_at=NOW(), acted_by=$3 WHERE tenant_id=$1 AND reference_id=$2 AND status='pending'`,
        [req.tenantId, req.params.id, req.user.id]
      );

      // Notify requester (unless they cancelled themselves)
      await db.query(`INSERT INTO notifications (tenant_id, user_id, type, title, message) VALUES ($1,$2,'request_cancelled','Request Cancelled',$3)`,
        [req.tenantId, reqData.requester_id, `Request ${reqData.ticket_number} was cancelled by ${actingUser.first_name} ${actingUser.last_name}: ${comments||''}`]).catch(()=>{});
      // Email - send to requester about cancellation
      if (requester) {
        EmailService.sendRequestRejected({
          request: reqData, requester, approver: actingUser,
          reason: `Request cancelled: ${comments||'No reason provided'}`
        }).catch(()=>{});
      }
      return res.json({ message: 'Request cancelled' });
    }

    // Approve or Reject
    await db.query(
      `UPDATE access_requests SET status=$1, resolved_at=NOW(), resolved_by=$2, resolution_notes=$3, updated_at=NOW() WHERE id=$4 AND tenant_id=$5`,
      [action, req.user.id, comments, req.params.id, req.tenantId]
    );

    // Close work items - for workgroup: only close this approver's item
    await db.query(
      `UPDATE work_items SET status=$1, acted_at=NOW(), acted_by=$2, action_comments=$3
       WHERE tenant_id=$4 AND reference_id=$5 AND assignee_id=$2 AND status='pending'`,
      [action, req.user.id, comments||action, req.tenantId, req.params.id]
    );
    // If approved, close ALL remaining work items for this request
    if (action === 'approved') {
      const connectorEntitlements = await getRelevantConnectorsForRequest(req.tenantId, reqData);
      const provisionResults = [];

      if (!connectorEntitlements.length) {
        await db.query(
          `UPDATE access_requests SET resolution_notes=$2 WHERE id=$1 AND tenant_id=$3`,
          [reqData.id, 'Approved, but no target connector is mapped for this access item.', req.tenantId]
        ).catch(()=>{});
      }

      // One transaction per entitlement — SailPoint IIQ style per-item results
      for (const row of connectorEntitlements) {
        const entName  = row.entitlement_name || reqData.resource_name;
        const entValue = row.entitlement_value || '';
        const entId    = row.entitlement_id   || reqData.resource_id;
        const operation = 'grant_entitlement_access';
        const planPayload = {
          requestId: reqData.id, ticketNumber: reqData.ticket_number,
          target_user_id: reqData.target_user_id,
          resource_id: entId, resource_name: entName, entitlement_value: entValue,
          request_type: reqData.request_type, operation,
          payload: { target_user_id: reqData.target_user_id, resource_id: entId, resource_name: entName, entitlement_value: entValue, request_type: reqData.request_type },
        };
        const { rows: txRows } = await db.query(
          `INSERT INTO provisioning_transactions (tenant_id, request_id, target_user_id, connector_id, operation, status, plan_payload)
           VALUES ($1,$2,$3,$4,$5,'queued',$6::jsonb) RETURNING id`,
          [req.tenantId, reqData.id, reqData.target_user_id, row.id, operation, JSON.stringify(planPayload)]
        );
        const txId = txRows[0].id;
        try {
          const result = await ProvisioningEngine.executeTransaction(txId, req.tenantId, req.user.id);
          const success = ['successful','success','completed'].includes(result.status);
          provisionResults.push({ entitlement_id: entId, entitlement_name: entName, connector_name: row.name, status: success ? 'success' : 'failed', error: success ? null : (result.error || result.message || 'Provisioning failed') });
        } catch (e) {
          await db.query(`UPDATE provisioning_transactions SET status='failed', error_message=$2, completed_at=NOW() WHERE id=$1`, [txId, e.message]).catch(()=>{});
          provisionResults.push({ entitlement_id: entId, entitlement_name: entName, connector_name: row.name, status: 'failed', error: e.message });
        }
      }

      const succeeded = provisionResults.filter(r => r.status === 'success');
      const failed    = provisionResults.filter(r => r.status === 'failed');
      let accessDetails = '', notifMessage = '', notifType = 'request_approved', notifTitle = 'Access Approved';

      if (!connectorEntitlements.length) {
        accessDetails = 'Approved, but no target connector is mapped for this access item.';
        notifMessage  = `Your request ${reqData.ticket_number} was approved, but no target connector is mapped for fulfillment.`;
        notifType = 'provision_failed'; notifTitle = 'Access Approved — Provisioning Not Mapped';
      } else if (failed.length === 0) {
        if (reqData.request_type === 'role_grant' && reqData.resource_id) {
          await db.query(
            `INSERT INTO user_roles (user_id, role_id, tenant_id, assigned_by, justification, expires_at) VALUES ($1,$2,$3,$4,'Approved via access request',$5) ON CONFLICT DO NOTHING`,
            [reqData.target_user_id, reqData.resource_id, req.tenantId, req.user.id, reqData.expires_at]
          ).catch(()=>{});
        }
        if (reqData.request_type === 'entitlement_grant' && reqData.resource_id) {
          await db.query(
            `INSERT INTO user_entitlements (user_id, entitlement_id, tenant_id, granted_by, justification, expires_at) VALUES ($1,$2,$3,$4,'Approved via access request',$5) ON CONFLICT (user_id, entitlement_id) DO NOTHING`,
            [reqData.target_user_id, reqData.resource_id, req.tenantId, req.user.id, reqData.expires_at]
          ).catch(()=>{});
        }
        accessDetails = `All ${succeeded.length} entitlement(s) provisioned: ${succeeded.map(r => r.entitlement_name).join(', ')}`;
        notifMessage  = `Your request ${reqData.ticket_number} for ${reqData.resource_name} was approved and fully provisioned.`;
        const uniqueConnectorIds = [...new Set(connectorEntitlements.map(r => r.id))];
        if (reqData.target_user_id && uniqueConnectorIds.length) {
          setImmediate(async () => { for (const cid of uniqueConnectorIds) { try { await ProvisioningEngine.aggregateSingleUser(cid, req.tenantId, reqData.target_user_id); } catch {} } });
        }
      } else if (succeeded.length === 0) {
        accessDetails = `Provisioning failed for all entitlements: ${failed.map(r => `${r.entitlement_name} — ${r.error}`).join('; ')}`;
        notifMessage  = `Your request ${reqData.ticket_number} was approved but all provisioning failed.`;
        notifType = 'provision_failed'; notifTitle = 'Access Approved — Provisioning Failed';
      } else {
        if (reqData.request_type === 'role_grant' && reqData.resource_id) {
          await db.query(
            `INSERT INTO user_roles (user_id, role_id, tenant_id, assigned_by, justification, expires_at) VALUES ($1,$2,$3,$4,'Approved via access request (partial)',$5) ON CONFLICT DO NOTHING`,
            [reqData.target_user_id, reqData.resource_id, req.tenantId, req.user.id, reqData.expires_at]
          ).catch(()=>{});
        }
        const successList = succeeded.map(r => `✓ ${r.entitlement_name}`).join(', ');
        const failList    = failed.map(r => `✗ ${r.entitlement_name} (${r.error})`).join(', ');
        accessDetails = `Partial: ${successList} | Failed: ${failList}`;
        notifMessage  = `Your request ${reqData.ticket_number} was partially provisioned: ${succeeded.length} succeeded, ${failed.length} failed.`;
        notifType = 'provision_partial'; notifTitle = 'Access Approved — Partial Provisioning';
      }

      await db.query(`UPDATE access_requests SET resolution_notes=$2 WHERE id=$1 AND tenant_id=$3`, [reqData.id, accessDetails, req.tenantId]).catch(()=>{});
      await db.query(`INSERT INTO notifications (tenant_id, user_id, type, title, message) VALUES ($1,$2,$3,$4,$5)`, [req.tenantId, reqData.requester_id, notifType, notifTitle, notifMessage]).catch(()=>{});
      EmailService.sendRequestApproved({ request: reqData, requester, approver: actingUser, accessDetails }).catch(()=>{});
    }

    if (action === 'rejected') {
      await db.query(
        `INSERT INTO notifications (tenant_id, user_id, type, title, message) VALUES ($1,$2,'request_rejected','Access Rejected',$3)`,
        [req.tenantId, reqData.requester_id, `Your request ${reqData.ticket_number} was rejected: ${comments||''}`]
      ).catch(()=>{});
      EmailService.sendRequestRejected({ request: reqData, requester, approver: actingUser, reason: comments }).catch(()=>{});
    }

    res.json({ message: `Request ${action}` });
  } catch(err) {
    logger.error('action failed', { error: err.message });
    res.status(500).json({ error: 'Action failed: ' + err.message });
  }
});

module.exports = router;
