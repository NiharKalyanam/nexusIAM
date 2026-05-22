const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const EmailService = require('../services/email/EmailService');
const logger = require('../config/logger');

// GET all certifications
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, u.first_name||' '||u.last_name as created_by_name,
              COUNT(ci.id) as total_items,
              SUM(CASE WHEN ci.decision='certified' THEN 1 ELSE 0 END) as certified_count,
              SUM(CASE WHEN ci.decision='revoke' THEN 1 ELSE 0 END) as revoked_count,
              SUM(CASE WHEN ci.decision='pending' THEN 1 ELSE 0 END) as pending_count
       FROM certifications c
       LEFT JOIN users u ON u.id=c.created_by
       LEFT JOIN certification_items ci ON ci.certification_id=c.id
       WHERE c.tenant_id=$1 GROUP BY c.id,u.id ORDER BY c.created_at DESC`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch certifications' }); }
});

// POST create campaign
router.post('/', authenticate, auditLog('certification.create'), async (req, res) => {
  try {
    const { name, description, type, due_date, scope_config } = req.body;
    const { rows } = await db.query(
      `INSERT INTO certifications (tenant_id,name,description,type,due_date,scope_config,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.tenantId, name, description, type, due_date, JSON.stringify(scope_config||{}), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to create certification' }); }
});

// POST launch campaign — generates items AND sends reviewer emails
router.post('/:id/launch', authenticate, auditLog('certification.launch'), async (req, res) => {
  try {
    const certRes = await db.query('SELECT * FROM certifications WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (!certRes.rows.length) return res.status(404).json({ error: 'Not found' });
    const cert = certRes.rows[0];

    // Get all active user-role assignments
    const assignments = await db.query(
      `SELECT ur.user_id, ur.role_id, r.name as role_name, u.last_login,
              u.email as reviewer_email, u.first_name, u.last_name
       FROM user_roles ur
       JOIN users u ON u.id=ur.user_id
       JOIN roles r ON r.id=ur.role_id
       WHERE ur.tenant_id=$1 AND ur.status='active'`,
      [req.tenantId]
    );

    // Get reviewers (managers / IAM admins)
    const { rows: reviewers } = await db.query(
      `SELECT DISTINCT u.* FROM users u
       JOIN user_roles ur ON ur.user_id=u.id AND ur.status='active'
       JOIN roles r ON r.id=ur.role_id
       WHERE r.name IN ('Super Admin','IAM Admin','Manager') AND ur.tenant_id=$1 AND u.status='active'`,
      [req.tenantId]
    );
    const primaryReviewer = reviewers[0];

    // Create items, distributing across reviewers
    let itemCount = 0;
    const reviewerItemCounts = {};
    for (const [i, a] of assignments.rows.entries()) {
      const reviewer = reviewers[i % reviewers.length] || primaryReviewer;
      if (!reviewer) continue;
      await db.query(
        `INSERT INTO certification_items (certification_id,reviewer_id,subject_user_id,resource_type,resource_id,resource_name,last_login,decision)
         VALUES ($1,$2,$3,'role',$4,$5,$6,'pending')
         ON CONFLICT DO NOTHING`,
        [req.params.id, reviewer.id, a.user_id, a.role_id, a.role_name, a.last_login]
      );
      reviewerItemCounts[reviewer.id] = (reviewerItemCounts[reviewer.id] || 0) + 1;
      itemCount++;
    }

    await db.query(`UPDATE certifications SET status='active', launched_at=NOW() WHERE id=$1`, [req.params.id]);

    // ── EMAILS: one per reviewer with their item count ──────────────────────
    for (const reviewer of reviewers) {
      const count = reviewerItemCounts[reviewer.id] || 0;
      if (count === 0) continue;
      EmailService.sendCertificationLaunched({
        campaign: cert, reviewer, itemCount: count,
        dueDate: cert.due_date || new Date(Date.now() + 14 * 86400000),
      }).catch(e => logger.warn('[EMAIL] cert launch failed', { error: e.message }));
    }

    res.json({ message: 'Certification launched', itemsCreated: itemCount, reviewers: reviewers.length });
  } catch (err) {
    logger.error('cert launch failed', { error: err.message });
    res.status(500).json({ error: 'Failed to launch certification' });
  }
});

// GET items for a campaign
router.get('/:id/items', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ci.*, 
              u.first_name||' '||u.last_name as subject_name, u.email as subject_email, u.department, u.last_login,
              r2.first_name||' '||r2.last_name as reviewer_name
       FROM certification_items ci
       JOIN users u ON u.id=ci.subject_user_id
       LEFT JOIN users r2 ON r2.id=ci.reviewer_id
       WHERE ci.certification_id=$1 ORDER BY u.last_name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch items' }); }
});

// PUT decision on a single item (certify / revoke)
router.put('/:id/items/:itemId', authenticate, auditLog('certification.decision'), async (req, res) => {
  try {
    const { decision, decision_reason } = req.body;
    if (!['certified', 'revoke'].includes(decision)) return res.status(400).json({ error: 'Invalid decision: certified or revoke' });

    await db.query(
      `UPDATE certification_items SET decision=$1, decision_reason=$2, decided_at=NOW(), decided_by=$3 WHERE id=$4`,
      [decision, decision_reason, req.user.id, req.params.itemId]
    );

    if (decision === 'revoke') {
      const { rows: itemRows } = await db.query(
        `SELECT ci.*, u.email, u.first_name, u.last_name FROM certification_items ci
         JOIN users u ON u.id=ci.subject_user_id WHERE ci.id=$1`,
        [req.params.itemId]
      );
      const item = itemRows[0];
      if (!item) return res.json({ message: 'Decision recorded' });

      if (item.resource_type === 'role') {
        await db.query(
          `UPDATE user_roles SET status='revoked', updated_at=NOW() WHERE user_id=$1 AND role_id=$2`,
          [item.subject_user_id, item.resource_id]
        );
      }

      // Get the certification campaign info
      const { rows: certRows } = await db.query('SELECT * FROM certifications WHERE id=$1', [req.params.id]);
      const reviewer = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id]);

      // ── EMAIL: notify user their access was revoked by certification ────
      EmailService.sendAccessRevokedByCertification({
        user: { email: item.email, first_name: item.first_name, last_name: item.last_name },
        role: item.resource_name,
        campaign: certRows.rows?.[0] || certRows[0] || { name: 'Access Certification' },
        reviewer: reviewer.rows?.[0] || reviewer[0] || { first_name: 'Reviewer', last_name: '' },
        reason: decision_reason,
      }).catch(e => logger.warn('[EMAIL] cert revoke email failed', { error: e.message }));
    }

    // Check if campaign is now fully decided → send completion email
    const { rows: stats } = await db.query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN decision='pending' THEN 1 ELSE 0 END) as still_pending,
              SUM(CASE WHEN decision='certified' THEN 1 ELSE 0 END) as certified,
              SUM(CASE WHEN decision='revoke' THEN 1 ELSE 0 END) as revoked
       FROM certification_items WHERE certification_id=$1`,
      [req.params.id]
    );
    const s = stats[0];
    if (parseInt(s.still_pending) === 0) {
      await db.query(`UPDATE certifications SET status='completed', completed_at=NOW() WHERE id=$1`, [req.params.id]);
      const { rows: certData } = await db.query(
        `SELECT c.*, u.* FROM certifications c JOIN users u ON u.id=c.created_by WHERE c.id=$1`,
        [req.params.id]
      );
      if (certData.length) {
        EmailService.sendCertificationComplete({
          campaign: certData[0],
          owner: certData[0],
          stats: { total: s.total, certified: s.certified, revoked: s.revoked, pending: 0 },
        }).catch(() => {});
      }
    }

    res.json({ message: 'Decision recorded', stats: s });
  } catch (err) {
    logger.error('cert decision failed', { error: err.message });
    res.status(500).json({ error: 'Failed to record decision' });
  }
});

// POST send reminder to all pending reviewers
router.post('/:id/remind', authenticate, async (req, res) => {
  try {
    const { rows: certRows } = await db.query('SELECT * FROM certifications WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (!certRows.length) return res.status(404).json({ error: 'Not found' });
    const campaign = certRows[0];
    const dueDate = campaign.due_date;
    const daysRemaining = dueDate ? Math.max(0, Math.ceil((new Date(dueDate) - Date.now()) / 86400000)) : 7;

    // Get reviewers with pending items
    const { rows: pending } = await db.query(
      `SELECT u.*, COUNT(ci.id) as pending_count FROM certification_items ci
       JOIN users u ON u.id=ci.reviewer_id
       WHERE ci.certification_id=$1 AND ci.decision='pending'
       GROUP BY u.id`,
      [req.params.id]
    );

    for (const reviewer of pending) {
      EmailService.sendCertificationReminder({
        campaign, reviewer,
        pendingCount: parseInt(reviewer.pending_count),
        daysRemaining, dueDate,
      }).catch(() => {});
    }

    res.json({ message: `Reminders sent to ${pending.length} reviewer(s)` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
