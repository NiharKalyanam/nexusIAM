const express = require('express');
const r1 = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

r1.get('/', authenticate, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
  const { rows } = await db.query(
    `SELECT * FROM notifications WHERE user_id=$1 OR (tenant_id=$2 AND user_id IS NULL) ORDER BY created_at DESC LIMIT $3`,
    [req.user.id, req.tenantId, limit]
  );
  res.json({ data: rows, total: rows.length });
});

r1.get('/summary', authenticate, async (req, res) => {
  const [notif, work] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS unread FROM notifications WHERE (user_id=$1 OR (tenant_id=$2 AND user_id IS NULL)) AND read=false`, [req.user.id, req.tenantId]),
    db.query(`SELECT COUNT(*)::int AS pending FROM work_items WHERE tenant_id=$1 AND assignee_id=$2 AND status='pending'`, [req.tenantId, req.user.id]),
  ]);
  res.json({ unread: notif.rows[0]?.unread || 0, pendingWorkItems: work.rows[0]?.pending || 0 });
});

r1.put('/:id/read', authenticate, async (req, res) => {
  await db.query(`UPDATE notifications SET read=true WHERE id=$1`, [req.params.id]);
  res.json({ message: 'Marked as read' });
});

r1.put('/read-all', authenticate, async (req, res) => {
  await db.query(`UPDATE notifications SET read=true WHERE user_id=$1`, [req.user.id]);
  res.json({ message: 'All marked as read' });
});

module.exports = r1;
