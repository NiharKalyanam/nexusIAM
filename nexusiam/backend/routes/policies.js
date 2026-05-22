const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const EmailService = require('../services/email/EmailService');
const logger = require('../config/logger');

router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, COUNT(pv.id) as violation_count
       FROM policies p LEFT JOIN policy_violations pv ON pv.policy_id=p.id AND pv.status='open'
       WHERE p.tenant_id=$1 GROUP BY p.id ORDER BY p.created_at DESC`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch policies' }); }
});

router.post('/', authenticate, auditLog('policy.create'), async (req, res) => {
  try {
    const { name, description, type, rules, enforcement } = req.body;
    const { rows } = await db.query(
      `INSERT INTO policies (tenant_id, name, description, type, rules, enforcement)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.tenantId, name, description, type, JSON.stringify(rules), enforcement || 'enforce']
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to create policy' }); }
});

router.get('/violations', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT pv.*, p.name as policy_name, u.email as user_email, u.first_name||' '||u.last_name as user_name
       FROM policy_violations pv
       JOIN policies p ON p.id=pv.policy_id
       JOIN users u ON u.id=pv.user_id
       WHERE pv.tenant_id=$1 ORDER BY pv.detected_at DESC LIMIT 100`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch violations' }); }
});

router.post('/scan', authenticate, async (req, res) => {
  try {
    // Run SoD policy scan
    const policies = await db.query(
      `SELECT * FROM policies WHERE tenant_id=$1 AND type='sod' AND is_active=true`,
      [req.tenantId]
    );
    let violationsFound = 0;
    for (const policy of policies.rows) {
      for (const rule of policy.rules) {
        if (rule.role_a && rule.role_b) {
          const { rows: conflicts } = await db.query(
            `SELECT ur1.user_id FROM user_roles ur1
             JOIN roles r1 ON r1.id=ur1.role_id AND r1.name=$1
             JOIN user_roles ur2 ON ur2.user_id=ur1.user_id
             JOIN roles r2 ON r2.id=ur2.role_id AND r2.name=$2
             WHERE ur1.tenant_id=$3 AND ur1.status='active' AND ur2.status='active'`,
            [rule.role_a, rule.role_b, req.tenantId]
          );
          for (const conflict of conflicts) {
            await db.query(
              `INSERT INTO policy_violations (tenant_id, policy_id, user_id, violation_type, details, severity)
               VALUES ($1,$2,$3,'sod_conflict',$4,'high')
               ON CONFLICT DO NOTHING`,
              [req.tenantId, policy.id, conflict.user_id, JSON.stringify(rule)]
            );
            violationsFound++;
            // ── EMAIL: notify user + compliance of SoD violation ─────────
            const { rows: violatingUser } = await db.query('SELECT * FROM users WHERE id=$1', [conflict.user_id]);
            if (violatingUser[0]) {
              EmailService.sendSodViolationDetected({
                user: violatingUser[0],
                policy,
                violationType: 'sod_conflict',
                roles: [rule.role_a, rule.role_b],
                severity: 'high',
                complianceEmail: process.env.COMPLIANCE_EMAIL,
              }).catch(e => logger.warn('[EMAIL] SoD email failed', { error: e.message }));
            }
          }
        }
      }
    }
    res.json({ message: 'Scan complete', violationsFound });
  } catch (err) { res.status(500).json({ error: 'Policy scan failed' }); }
});

module.exports = router;
