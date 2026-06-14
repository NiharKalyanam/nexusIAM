/**
 * NexusIAM Reports API
 * 12 report endpoints covering all IAM dimensions.
 * All support ?format=csv for direct export.
 * Tableau can also connect directly to PostgreSQL read-only views.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { stringify } = require('csv-stringify/sync');
const logger = require('../config/logger');

// ─── CSV/JSON Response Helper ─────────────────────────────────────────────────
function respond(res, rows, filename, format) {
  if (format === 'csv') {
    const csv = stringify(rows, { header: true, cast: { date: v => v?.toISOString?.() || String(v) } });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(csv);
  }
  res.json({ data: rows, count: rows.length, generated_at: new Date().toISOString() });
}

// ─── 1. User Access Summary ───────────────────────────────────────────────────
// Best for: "Who has access to what" — core IAM visibility report
router.get('/user-access', authenticate, async (req, res) => {
  try {
    const { format = 'json', department, status = 'active' } = req.query;
    let where = 'WHERE u.tenant_id = $1';
    const params = [req.tenantId];
    let idx = 2;
    if (status) { where += ` AND u.status = $${idx++}`; params.push(status); }
    if (department) { where += ` AND u.department = $${idx++}`; params.push(department); }

    const { rows } = await db.query(`
      SELECT
        u.username, u.email, u.first_name, u.last_name, u.department, u.title,
        u.status, u.employee_id, u.source,
        u.last_login, u.created_at, u.mfa_enabled,
        COUNT(DISTINCT ur.role_id) FILTER (WHERE ur.status = 'active') AS active_role_count,
        string_agg(DISTINCT r.name, ' | ') FILTER (WHERE ur.status = 'active') AS roles,
        MAX(ur.expires_at) FILTER (WHERE ur.status = 'active') AS earliest_expiry,
        COUNT(DISTINCT ar.id) FILTER (WHERE ar.status = 'approved') AS approved_requests_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE pv.status = 'open') AS open_violations
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN access_requests ar ON ar.requester_id = u.id
      LEFT JOIN policy_violations pv ON pv.user_id = u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.department, u.last_name, u.first_name
    `, params);

    respond(res, rows, 'user-access-report', format);
  } catch (err) {
    logger.error('user-access report failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── 2. Role Membership Report ────────────────────────────────────────────────
// Best for: "Who is in each role" — Tableau dimension: role vs department
router.get('/role-membership', authenticate, async (req, res) => {
  try {
    const { format = 'json', role_name } = req.query;
    const params = [req.tenantId];
    let roleFilter = '';
    if (role_name) { roleFilter = 'AND r.name ILIKE $2'; params.push(`%${role_name}%`); }

    const { rows } = await db.query(`
      SELECT
        r.name AS role_name, r.type AS role_type, r.description AS role_description,
        u.username, u.email, u.first_name, u.last_name, u.department, u.title,
        u.status AS user_status, u.last_login,
        ur.assigned_at, ur.expires_at, ur.justification,
        assigned_by.username AS assigned_by_username
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN users u ON u.id = ur.user_id
      LEFT JOIN users assigned_by ON assigned_by.id = ur.assigned_by
      WHERE ur.tenant_id = $1 AND ur.status = 'active' ${roleFilter}
      ORDER BY r.name, u.department, u.last_name
    `, params);

    respond(res, rows, 'role-membership-report', format);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 3. Access Request Analytics ─────────────────────────────────────────────
// Best for: trends, approval rates, SLA compliance — great for Tableau time series
router.get('/access-requests', authenticate, async (req, res) => {
  try {
    const { format = 'json', days = 90, status } = req.query;
    const params = [req.tenantId, parseInt(days)];
    let statusFilter = '';
    if (status) { statusFilter = 'AND ar.status = $3'; params.push(status); }

    const { rows } = await db.query(`
      SELECT
        ar.ticket_number, ar.request_type, ar.status, ar.priority,
        ar.justification, ar.requested_at, ar.resolved_at,
        EXTRACT(EPOCH FROM (ar.resolved_at - ar.requested_at)) / 3600 AS resolution_hours,
        ar.duration_days, ar.expires_at,
        req.username AS requester_username, req.email AS requester_email,
        req.department AS requester_department,
        tgt.username AS target_username, tgt.email AS target_email,
        tgt.department AS target_department,
        r.name AS role_requested,
        resolver.username AS resolved_by_username,
        ar.resolution_notes
      FROM access_requests ar
      JOIN users req ON req.id = ar.requester_id
      LEFT JOIN users tgt ON tgt.id = ar.target_user_id
      LEFT JOIN roles r ON r.id = ar.resource_id
      LEFT JOIN users resolver ON resolver.id = ar.resolved_by
      WHERE ar.tenant_id = $1
        AND ar.requested_at >= NOW() - ($2 || ' days')::INTERVAL
        ${statusFilter}
      ORDER BY ar.requested_at DESC
    `, params);

    respond(res, rows, 'access-requests-report', format);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 4. Access Request Summary (KPIs) ────────────────────────────────────────
// Best for: executive dashboard — approval rate, avg resolution time, by department
router.get('/access-requests/summary', authenticate, async (req, res) => {
  try {
    const { days = 90 } = req.query;
    const { rows } = await db.query(`
      SELECT
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired,
        ROUND(COUNT(*) FILTER (WHERE status = 'approved')::numeric / NULLIF(COUNT(*) FILTER (WHERE status IN ('approved','rejected')),0) * 100, 1) AS approval_rate_pct,
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - requested_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL), 1) AS avg_resolution_hours,
        COUNT(*) FILTER (WHERE priority = 'urgent') AS urgent_requests,
        COUNT(*) FILTER (WHERE priority = 'high') AS high_requests
      FROM access_requests
      WHERE tenant_id = $1 AND requested_at >= NOW() - ($2 || ' days')::INTERVAL
    `, [req.tenantId, parseInt(days)]);

    // By department
    const { rows: byDept } = await db.query(`
      SELECT
        u.department,
        COUNT(ar.id) AS total,
        COUNT(ar.id) FILTER (WHERE ar.status = 'approved') AS approved,
        COUNT(ar.id) FILTER (WHERE ar.status = 'rejected') AS rejected,
        ROUND(AVG(EXTRACT(EPOCH FROM (ar.resolved_at - ar.requested_at)) / 3600) FILTER (WHERE ar.resolved_at IS NOT NULL), 1) AS avg_hours
      FROM access_requests ar
      JOIN users u ON u.id = ar.requester_id
      WHERE ar.tenant_id = $1 AND ar.requested_at >= NOW() - ($2 || ' days')::INTERVAL
      GROUP BY u.department ORDER BY total DESC
    `, [req.tenantId, parseInt(days)]);

    // By day (time series for Tableau)
    const { rows: byDay } = await db.query(`
      SELECT
        DATE_TRUNC('day', requested_at) AS date,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
      FROM access_requests
      WHERE tenant_id = $1 AND requested_at >= NOW() - ($2 || ' days')::INTERVAL
      GROUP BY DATE_TRUNC('day', requested_at)
      ORDER BY date
    `, [req.tenantId, parseInt(days)]);

    res.json({ summary: rows[0], by_department: byDept, by_day: byDay, generated_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 5. SoD Violations Report ─────────────────────────────────────────────────
// Best for: compliance, audit, risk reporting
router.get('/sod-violations', authenticate, async (req, res) => {
  try {
    const { format = 'json', severity, status = 'open' } = req.query;
    const params = [req.tenantId];
    let filters = '';
    let idx = 2;
    if (status) { filters += ` AND pv.status = $${idx++}`; params.push(status); }
    if (severity) { filters += ` AND pv.severity = $${idx++}`; params.push(severity); }

    const { rows } = await db.query(`
      SELECT
        pv.violation_type, pv.severity, pv.status,
        pv.detected_at, pv.resolved_at,
        p.name AS policy_name, p.description AS policy_description,
        p.enforcement AS policy_enforcement,
        u.username, u.email, u.first_name, u.last_name, u.department, u.title,
        pv.details
      FROM policy_violations pv
      JOIN policies p ON p.id = pv.policy_id
      JOIN users u ON u.id = pv.user_id
      WHERE pv.tenant_id = $1 ${filters}
      ORDER BY
        CASE pv.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        pv.detected_at DESC
    `, params);

    respond(res, rows, 'sod-violations-report', format);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 6. Certification Status Report ──────────────────────────────────────────
// Best for: compliance, completion rate per campaign
router.get('/certification-status', authenticate, async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    const { rows } = await db.query(`
      SELECT
        c.name AS campaign_name, c.type, c.status, c.due_date,
        c.created_at AS launched_at, c.completed_at,
        created_by.username AS created_by,
        COUNT(ci.id) AS total_items,
        COUNT(ci.id) FILTER (WHERE ci.decision = 'certified') AS certified,
        COUNT(ci.id) FILTER (WHERE ci.decision = 'revoke') AS revoked,
        COUNT(ci.id) FILTER (WHERE ci.decision = 'pending') AS pending,
        ROUND(COUNT(ci.id) FILTER (WHERE ci.decision != 'pending')::numeric / NULLIF(COUNT(ci.id),0) * 100, 1) AS completion_pct,
        ROUND(COUNT(ci.id) FILTER (WHERE ci.decision = 'revoke')::numeric / NULLIF(COUNT(ci.id) FILTER (WHERE ci.decision != 'pending'),0) * 100, 1) AS revoke_rate_pct
      FROM certifications c
      LEFT JOIN certification_items ci ON ci.certification_id = c.id
      LEFT JOIN users created_by ON created_by.id = c.created_by
      WHERE c.tenant_id = $1
      GROUP BY c.id, created_by.username
      ORDER BY c.created_at DESC
    `, [req.tenantId]);

    respond(res, rows, 'certification-status-report', format);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 7. Certification Items Detail ────────────────────────────────────────────
// Best for: reviewer-level drill-down, who certified/revoked what
router.get('/certification-items', authenticate, async (req, res) => {
  try {
    const { format = 'json', campaign_id, decision } = req.query;
    const params = [req.tenantId];
    let filters = '';
    let idx = 2;
    if (campaign_id) { filters += ` AND c.id = $${idx++}`; params.push(campaign_id); }
    if (decision) { filters += ` AND ci.decision = $${idx++}`; params.push(decision); }

    const { rows } = await db.query(`
      SELECT
        c.name AS campaign_name, c.type AS campaign_type, c.due_date,
        u.username AS subject_username, u.email AS subject_email,
        u.first_name, u.last_name, u.department, u.title,
        ci.resource_name AS role_name, ci.decision, ci.decision_reason,
        ci.decided_at,
        reviewer.username AS reviewer_username, reviewer.email AS reviewer_email,
        u.last_login AS subject_last_login
      FROM certification_items ci
      JOIN certifications c ON c.id = ci.certification_id
      JOIN users u ON u.id = ci.subject_user_id
      LEFT JOIN users reviewer ON reviewer.id = ci.reviewer_id
      WHERE c.tenant_id = $1 ${filters}
      ORDER BY c.name, ci.decision, u.last_name
    `, params);

    respond(res, rows, 'certification-items-report', format);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 8. Connector Sync Health Report ──────────────────────────────────────────
// Best for: operational monitoring, sync success/failure rates
router.get('/connector-health', authenticate, async (req, res) => {
  try {
    const { format = 'json', days = 30 } = req.query;
    const { rows } = await db.query(`
      SELECT
        c.name AS connector_name, c.type AS connector_type,
        c.status AS connector_status, c.provisioning_direction,
        c.sync_schedule, c.last_sync,
        COUNT(sj.id) AS total_syncs,
        COUNT(sj.id) FILTER (WHERE sj.status = 'completed') AS successful_syncs,
        COUNT(sj.id) FILTER (WHERE sj.status = 'failed') AS failed_syncs,
        ROUND(COUNT(sj.id) FILTER (WHERE sj.status = 'completed')::numeric / NULLIF(COUNT(sj.id),0) * 100, 1) AS success_rate_pct,
        SUM(sj.records_processed) AS total_records_processed,
        AVG(EXTRACT(EPOCH FROM (sj.completed_at - sj.started_at))) AS avg_sync_duration_secs,
        MAX(sj.started_at) AS last_sync_at,
        MAX(sj.started_at) FILTER (WHERE sj.status = 'failed') AS last_failure_at
      FROM connectors c
      LEFT JOIN sync_jobs sj ON sj.connector_id = c.id
        AND sj.started_at >= NOW() - ($2 || ' days')::INTERVAL
      WHERE c.tenant_id = $1
      GROUP BY c.id
      ORDER BY c.name
    `, [req.tenantId, parseInt(days)]);

    respond(res, rows, 'connector-health-report', format);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 9. Audit Log Report ──────────────────────────────────────────────────────
// Best for: forensics, compliance audit trail
router.get('/audit-log', authenticate, async (req, res) => {
  try {
    const { format = 'json', days = 30, action, user_id } = req.query;
    const params = [req.tenantId, parseInt(days)];
    let filters = '';
    let idx = 3;
    if (action) { filters += ` AND al.action ILIKE $${idx++}`; params.push(`%${action}%`); }
    if (user_id) { filters += ` AND al.user_id = $${idx++}`; params.push(user_id); }

    const { rows } = await db.query(`
      SELECT
        al.action, al.resource_type, al.resource_id,
        al.ip_address, al.user_agent,
        al.created_at AS timestamp,
        al.details,
        u.username, u.email, u.department
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.tenant_id = $1
        AND al.created_at >= NOW() - ($2 || ' days')::INTERVAL
        ${filters}
      ORDER BY al.created_at DESC
      LIMIT 5000
    `, params);

    respond(res, rows, 'audit-log-report', format);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 10. Dormant Users Report ─────────────────────────────────────────────────
// Best for: access hygiene — users who haven't logged in but still have active roles
router.get('/dormant-users', authenticate, async (req, res) => {
  try {
    const { format = 'json', inactive_days = 90 } = req.query;
    const { rows } = await db.query(`
      SELECT
        u.username, u.email, u.first_name, u.last_name, u.department, u.title,
        u.status, u.last_login, u.created_at, u.source,
        u.last_login IS NULL AS never_logged_in,
        EXTRACT(DAY FROM NOW() - u.last_login) AS days_since_login,
        COUNT(ur.role_id) FILTER (WHERE ur.status = 'active') AS active_role_count,
        string_agg(r.name, ' | ') FILTER (WHERE ur.status = 'active') AS active_roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.tenant_id = $1
        AND u.status = 'active'
        AND (u.last_login IS NULL OR u.last_login < NOW() - ($2 || ' days')::INTERVAL)
      GROUP BY u.id
      HAVING COUNT(ur.role_id) FILTER (WHERE ur.status = 'active') > 0
      ORDER BY days_since_login DESC NULLS FIRST
    `, [req.tenantId, parseInt(inactive_days)]);

    respond(res, rows, 'dormant-users-report', format);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 11. Privileged Access Report ────────────────────────────────────────────
// Best for: PAM visibility — who has admin/privileged roles
router.get('/privileged-access', authenticate, async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    const { rows } = await db.query(`
      SELECT
        u.username, u.email, u.first_name, u.last_name, u.department, u.title,
        u.status, u.last_login, u.mfa_enabled,
        r.name AS privileged_role, r.type AS role_type,
        ur.assigned_at, ur.expires_at, ur.justification,
        assigned_by.username AS assigned_by,
        CASE WHEN ur.expires_at IS NULL THEN 'permanent' ELSE 'temporary' END AS access_type
      FROM user_roles ur
      JOIN users u ON u.id = ur.user_id
      JOIN roles r ON r.id = ur.role_id
      LEFT JOIN users assigned_by ON assigned_by.id = ur.assigned_by
      WHERE ur.tenant_id = $1
        AND ur.status = 'active'
        AND (r.type = 'admin' OR r.name ILIKE '%admin%' OR r.name ILIKE '%super%' OR r.name ILIKE '%privilege%')
      ORDER BY r.name, u.department, u.last_name
    `, [req.tenantId]);

    respond(res, rows, 'privileged-access-report', format);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 12. Executive Dashboard Summary ─────────────────────────────────────────
// Single endpoint with all KPIs — perfect for embedding in Tableau dashboards
router.get('/executive-summary', authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const d = parseInt(days);

    const [users, roles, requests, certs, violations, connectors, dormant, privileged] = await Promise.all([
      db.query(`SELECT
        COUNT(*) AS total_users,
        COUNT(*) FILTER (WHERE status='active') AS active_users,
        COUNT(*) FILTER (WHERE status='inactive') AS inactive_users,
        COUNT(*) FILTER (WHERE mfa_enabled=true) AS mfa_enabled_users,
        ROUND(COUNT(*) FILTER (WHERE mfa_enabled=true)::numeric / NULLIF(COUNT(*) FILTER (WHERE status='active'),0)*100,1) AS mfa_adoption_pct,
        COUNT(*) FILTER (WHERE created_at >= NOW() - ($2||' days')::INTERVAL) AS new_users
        FROM users WHERE tenant_id=$1`, [req.tenantId, d]),

      db.query(`SELECT COUNT(DISTINCT role_id) AS total_role_assignments,
        COUNT(DISTINCT user_id) AS users_with_roles FROM user_roles WHERE tenant_id=$1 AND status='active'`, [req.tenantId]),

      db.query(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='pending') AS pending,
        COUNT(*) FILTER (WHERE status='approved') AS approved,
        COUNT(*) FILTER (WHERE status='rejected') AS rejected,
        ROUND(COUNT(*) FILTER (WHERE status='approved')::numeric / NULLIF(COUNT(*) FILTER (WHERE status IN ('approved','rejected')),0)*100,1) AS approval_rate_pct,
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at-requested_at))/3600) FILTER (WHERE resolved_at IS NOT NULL),1) AS avg_resolution_hours
        FROM access_requests WHERE tenant_id=$1 AND requested_at >= NOW()-($2||' days')::INTERVAL`, [req.tenantId, d]),

      db.query(`SELECT
        COUNT(*) FILTER (WHERE status='active') AS active_campaigns,
        COUNT(*) FILTER (WHERE status='completed') AS completed_campaigns,
        SUM(CASE WHEN status IN ('active','completed') THEN 1 ELSE 0 END) AS total_campaigns
        FROM certifications WHERE tenant_id=$1`, [req.tenantId]),

      db.query(`SELECT
        COUNT(*) AS total_violations,
        COUNT(*) FILTER (WHERE status='open') AS open_violations,
        COUNT(*) FILTER (WHERE severity='critical') AS critical_violations,
        COUNT(*) FILTER (WHERE severity='high') AS high_violations
        FROM policy_violations WHERE tenant_id=$1`, [req.tenantId]),

      db.query(`SELECT
        COUNT(*) AS total_connectors,
        COUNT(*) FILTER (WHERE status='connected') AS connected,
        COUNT(*) FILTER (WHERE status='error') AS errored
        FROM connectors WHERE tenant_id=$1`, [req.tenantId]),

      db.query(`SELECT COUNT(DISTINCT u.id) AS dormant_with_access
        FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.status='active'
        WHERE u.tenant_id=$1 AND u.status='active'
          AND (u.last_login IS NULL OR u.last_login < NOW()-'90 days'::INTERVAL)`, [req.tenantId]),

      db.query(`SELECT COUNT(*) AS privileged_assignments FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.tenant_id=$1 AND ur.status='active' AND (r.type='admin' OR r.name ILIKE '%admin%')`, [req.tenantId]),
    ]);

    res.json({
      period_days: d,
      generated_at: new Date().toISOString(),
      users: users.rows[0],
      roles: roles.rows[0],
      access_requests: requests.rows[0],
      certifications: certs.rows[0],
      policy_violations: violations.rows[0],
      connectors: connectors.rows[0],
      risk_indicators: {
        dormant_users_with_access: parseInt(dormant.rows[0]?.dormant_with_access || 0),
        privileged_assignments: parseInt(privileged.rows[0]?.privileged_assignments || 0),
        open_violations: parseInt(violations.rows[0]?.open_violations || 0),
        mfa_adoption_pct: parseFloat(users.rows[0]?.mfa_adoption_pct || 0),
      },
    });
  } catch (err) {
    logger.error('executive-summary failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
