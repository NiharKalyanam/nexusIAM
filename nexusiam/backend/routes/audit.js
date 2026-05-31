// audit.js
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 50, action, user_id, from, to } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE a.tenant_id = $1';
    const params = [req.tenantId];
    let idx = 2;
    if (action) { where += ` AND a.action ILIKE $${idx++}`; params.push(`%${action}%`); }
    if (user_id) { where += ` AND a.user_id = $${idx++}`; params.push(user_id); }
    if (from) { where += ` AND a.created_at >= $${idx++}`; params.push(from); }
    if (to) { where += ` AND a.created_at <= $${idx++}`; params.push(to); }

    const count = await db.query(`SELECT COUNT(*) FROM audit_logs a ${where}`, params);
    const { rows } = await db.query(
      `SELECT a.*, u.email as user_email, u.first_name||' '||u.last_name as user_name
       FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
       ${where} ORDER BY a.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );
    res.json({ data: rows, total: parseInt(count.rows[0].count) });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch audit logs' }); }
});

module.exports = router;
