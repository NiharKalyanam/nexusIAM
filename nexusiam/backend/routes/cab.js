const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const EmailService = require('../services/email/EmailService');
const logger = require('../config/logger');

function genCaseNum() {
  return `CAB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2,5).toUpperCase()}`;
}

async function getCabMembers(tenantId) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.* FROM users u
     JOIN user_roles ur ON ur.user_id=u.id AND ur.status='active'
     JOIN roles r ON r.id=ur.role_id
     WHERE r.name IN ('Super Admin','CAB Member','IAM Admin','Change Manager') AND ur.tenant_id=$1 AND u.status='active'`,
    [tenantId]
  );
  return rows;
}

// GET all
router.get('/', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    let where = 'WHERE c.tenant_id=$1';
    const params = [req.tenantId];
    if (status) { where += ' AND c.status=$2'; params.push(status); }
    const { rows } = await db.query(
      `SELECT c.*, u1.first_name||' '||u1.last_name as requester_name, u2.first_name||' '||u2.last_name as assignee_name
       FROM cab_cases c
       LEFT JOIN users u1 ON u1.id=c.requester_id
       LEFT JOIN users u2 ON u2.id=c.assignee_id
       ${where} ORDER BY c.created_at DESC`, params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch CAB cases' }); }
});

// POST create — notify CAB members
router.post('/', authenticate, auditLog('cab.create'), async (req, res) => {
  try {
    const { title, description, type, risk_level, planned_start, planned_end, implementation_plan, rollback_plan, impact_assessment } = req.body;
    const { rows } = await db.query(
      `INSERT INTO cab_cases (tenant_id,case_number,title,description,type,risk_level,requester_id,planned_start,planned_end,implementation_plan,rollback_plan,impact_assessment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.tenantId, genCaseNum(), title, description, type||'change', risk_level||'medium',
       req.user.id, planned_start, planned_end, implementation_plan, rollback_plan, impact_assessment]
    );
    const cabCase = rows[0];

    // ── EMAILS: notify all CAB members ─────────────────────────────────────
    const requester = (await db.query('SELECT * FROM users WHERE id=$1', [req.user.id])).rows[0];
    const cabMembers = await getCabMembers(req.tenantId);
    EmailService.sendCabCaseSubmitted({ cabCase, requester, cabMembers })
      .catch(e => logger.warn('[EMAIL] CAB submitted failed', { error: e.message }));

    res.status(201).json(cabCase);
  } catch (err) { res.status(500).json({ error: 'Failed to create CAB case' }); }
});

// GET single
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, u1.first_name||' '||u1.last_name as requester_name, u1.email as requester_email
       FROM cab_cases c LEFT JOIN users u1 ON u1.id=c.requester_id
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch case' }); }
});

// PUT update status — send decision email on approve/reject
router.put('/:id/status', authenticate, auditLog('cab.status_update'), async (req, res) => {
  try {
    const { status, comments } = req.body;
    const valid = ['submitted','under_review','approved','rejected','implemented','closed'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const { rows } = await db.query(
      `UPDATE cab_cases SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [status, req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const cabCase = rows[0];

    // ── EMAILS: approved or rejected → email requester ──────────────────────
    if (status === 'approved' || status === 'rejected') {
      const requester = (await db.query('SELECT * FROM users WHERE id=$1', [cabCase.requester_id])).rows[0];
      const decidedBy = (await db.query('SELECT first_name,last_name FROM users WHERE id=$1', [req.user.id])).rows[0];
      EmailService.sendCabDecision({
        cabCase,
        requester,
        decision: status,
        decidedBy: decidedBy ? `${decidedBy.first_name} ${decidedBy.last_name}` : 'CAB Committee',
        reason: comments,
      }).catch(e => logger.warn('[EMAIL] CAB decision failed', { error: e.message }));
    }

    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to update case' }); }
});

module.exports = router;
