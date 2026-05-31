const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

// ── Get lifecycle events for a user ──────────────────────────────────────────
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT le.*,
              u.first_name || ' ' || u.last_name AS user_name,
              u.username
         FROM lifecycle_events le
         JOIN users u ON u.id = le.user_id
        WHERE le.user_id = $1 AND le.tenant_id = $2
        ORDER BY le.created_at DESC
        LIMIT 100`,
      [req.params.userId, req.tenantId]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lifecycle events' });
  }
});

// ── Get all lifecycle events (tenant-wide) ────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { type, page = 1, limit = 25 } = req.query;
    const offset = (Math.max(parseInt(page), 1) - 1) * parseInt(limit);
    const params = [req.tenantId];
    let where = 'le.tenant_id = $1';
    if (type) { params.push(type); where += ` AND le.event_type = $${params.length}`; }

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM lifecycle_events le WHERE ${where}`, params
    );
    const dataRes = await db.query(
      `SELECT le.*,
              u.first_name || ' ' || u.last_name AS user_name,
              u.username, u.email
         FROM lifecycle_events le
         JOIN users u ON u.id = le.user_id
        WHERE ${where}
        ORDER BY le.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), offset]
    );
    res.json({
      data: dataRes.rows,
      pagination: {
        total: countRes.rows[0]?.total || 0,
        page: parseInt(page), limit: parseInt(limit),
        pages: Math.ceil((countRes.rows[0]?.total || 0) / parseInt(limit))
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lifecycle events' });
  }
});

// ── Helper exported for use in other services ─────────────────────────────────
async function recordLifecycleEvent(tenantId, userId, eventType, options = {}) {
  try {
    await db.query(
      `INSERT INTO lifecycle_events
         (tenant_id, user_id, event_type, triggered_by, changed_attributes, previous_values, new_values)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,
      [tenantId, userId, eventType,
       options.triggeredBy || 'system',
       JSON.stringify(options.changedAttributes || {}),
       JSON.stringify(options.previousValues || {}),
       JSON.stringify(options.newValues || {})]
    );
  } catch (err) {
    console.error('[LIFECYCLE] record event failed:', err.message);
  }
}

module.exports = router;
module.exports.recordLifecycleEvent = recordLifecycleEvent;
