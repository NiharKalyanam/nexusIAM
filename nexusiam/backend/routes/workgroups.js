const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const EmailService = require('../services/email/EmailService');

// ── List workgroups ───────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { search = '', page = 1, limit = 25, member_user_id } = req.query;
    const offset = (Math.max(parseInt(page), 1) - 1) * parseInt(limit);
    const params = [req.tenantId];
    let where = 'w.tenant_id = $1';
    if (search) { params.push(`%${search}%`); where += ` AND w.name ILIKE $${params.length}`; }
    if (member_user_id) { params.push(member_user_id); where += ` AND EXISTS (SELECT 1 FROM workgroup_members wm WHERE wm.workgroup_id = w.id AND wm.user_id = $${params.length})`; }

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM workgroups w WHERE ${where}`, params
    );
    const dataRes = await db.query(
      `SELECT w.*,
              u.first_name || ' ' || u.last_name AS owner_name,
              u.email AS owner_email,
              (SELECT COUNT(*)::int FROM workgroup_members wm WHERE wm.workgroup_id = w.id) AS member_count
         FROM workgroups w
         LEFT JOIN users u ON u.id = w.owner_id
        WHERE ${where}
        ORDER BY w.name ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), offset]
    );
    res.json({
      data: dataRes.rows,
      pagination: {
        total: countRes.rows[0]?.total || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil((countRes.rows[0]?.total || 0) / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('[WORKGROUPS] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch workgroups' });
  }
});

// ── Get single workgroup with members ────────────────────────────────────────
router.get('/picker/search', authenticate, async (req, res) => {
  try {
    const { q = '', limit = 20 } = req.query;
    const search = `%${q}%`;

    const identities = await db.query(
      `SELECT id, username AS name, email, first_name, last_name,
              'identity' AS type, null AS member_count
         FROM users
        WHERE tenant_id=$1
          AND (username ILIKE $2 OR email ILIKE $2
               OR (first_name || ' ' || last_name) ILIKE $2)
          AND user_type != 'service_account'
        ORDER BY first_name, last_name
        LIMIT $3`,
      [req.tenantId, search, Math.floor(parseInt(limit) / 2)]
    );

    const workgroups = await db.query(
      `SELECT w.id, w.name, w.group_email AS email,
              null AS first_name, null AS last_name,
              'workgroup' AS type,
              (SELECT COUNT(*)::int FROM workgroup_members wm WHERE wm.workgroup_id = w.id) AS member_count
         FROM workgroups w
        WHERE w.tenant_id=$1 AND w.name ILIKE $2
        ORDER BY w.name
        LIMIT $3`,
      [req.tenantId, search, Math.floor(parseInt(limit) / 2)]
    );

    res.json({ results: [...workgroups.rows, ...identities.rows] });
  } catch (err) {
    console.error('[WORKGROUPS] picker error:', err.message);
    res.status(500).json({ error: 'Picker search failed' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT w.*,
              u.first_name || ' ' || u.last_name AS owner_name,
              u.email AS owner_email
         FROM workgroups w
         LEFT JOIN users u ON u.id = w.owner_id
        WHERE w.id = $1 AND w.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Workgroup not found' });

    const members = await db.query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.email, u.employee_id,
              u.department, u.status, wm.added_at
         FROM workgroup_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workgroup_id = $1
        ORDER BY u.first_name, u.last_name`,
      [req.params.id]
    );
    res.json({ ...rows[0], members: members.rows });
  } catch (err) {
    console.error('[WORKGROUPS] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch workgroup' });
  }
});

// ── Create workgroup ──────────────────────────────────────────────────────────
router.post('/', authenticate, auditLog('workgroup.create'), async (req, res) => {
  try {
    const { name, description, owner_id, group_email, notification_setting, capabilities } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const { rows } = await db.query(
      `INSERT INTO workgroups (tenant_id, name, description, owner_id, group_email, notification_setting, capabilities)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
      [req.tenantId, name.trim(), description || null, owner_id || null,
       group_email || null,
       notification_setting || 'members_and_email',
       JSON.stringify(capabilities || [])]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Workgroup name already exists' });
    console.error('[WORKGROUPS] create error:', err.message);
    res.status(500).json({ error: 'Failed to create workgroup' });
  }
});

// ── Update workgroup ──────────────────────────────────────────────────────────
router.put('/:id', authenticate, auditLog('workgroup.update'), async (req, res) => {
  try {
    const { name, description, owner_id, group_email, notification_setting, capabilities } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const { rows } = await db.query(
      `UPDATE workgroups SET
         name=$1, description=$2, owner_id=$3, group_email=$4,
         notification_setting=$5, capabilities=$6::jsonb, updated_at=NOW()
       WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [name.trim(), description || null, owner_id || null, group_email || null,
       notification_setting || 'members_and_email',
       JSON.stringify(capabilities || []),
       req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Workgroup not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Workgroup name already exists' });
    console.error('[WORKGROUPS] update error:', err.message);
    res.status(500).json({ error: 'Failed to update workgroup' });
  }
});

// ── Delete workgroup ──────────────────────────────────────────────────────────
router.delete('/:id', authenticate, auditLog('workgroup.delete'), async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM workgroups WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.tenantId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Workgroup not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[WORKGROUPS] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete workgroup' });
  }
});

// ── Add member ────────────────────────────────────────────────────────────────
router.post('/:id/members', authenticate, auditLog('workgroup.member.add'), async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    // Verify workgroup belongs to tenant
    const wg = await db.query(
      'SELECT * FROM workgroups WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]
    );
    if (!wg.rows.length) return res.status(404).json({ error: 'Workgroup not found' });

    // Verify user belongs to tenant
    const user = await db.query(
      'SELECT * FROM users WHERE id=$1 AND tenant_id=$2', [user_id, req.tenantId]
    );
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    await db.query(
      `INSERT INTO workgroup_members (tenant_id, workgroup_id, user_id, added_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [req.tenantId, req.params.id, user_id, req.userId]
    );

    // Send notification email
    try {
      await EmailService.sendWorkgroupMemberAdded({
        toEmail: user.rows[0].email,
        toName: `${user.rows[0].first_name} ${user.rows[0].last_name}`,
        workgroupName: wg.rows[0].name,
        groupEmail: wg.rows[0].group_email,
        notificationSetting: wg.rows[0].notification_setting,
      });
    } catch (emailErr) {
      console.warn('[WORKGROUPS] email send failed:', emailErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[WORKGROUPS] add member error:', err.message);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// ── Remove members ────────────────────────────────────────────────────────────
router.delete('/:id/members', authenticate, auditLog('workgroup.member.remove'), async (req, res) => {
  try {
    const { user_ids } = req.body;
    if (!user_ids?.length) return res.status(400).json({ error: 'user_ids array is required' });

    const wg = await db.query(
      'SELECT * FROM workgroups WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]
    );
    if (!wg.rows.length) return res.status(404).json({ error: 'Workgroup not found' });

    // Get user emails before deleting for notifications
    const users = await db.query(
      `SELECT u.* FROM users u
        JOIN workgroup_members wm ON wm.user_id = u.id
       WHERE wm.workgroup_id=$1 AND u.id = ANY($2::uuid[])`,
      [req.params.id, user_ids]
    );

    await db.query(
      'DELETE FROM workgroup_members WHERE workgroup_id=$1 AND user_id = ANY($2::uuid[])',
      [req.params.id, user_ids]
    );

    // Send removal notifications
    for (const user of users.rows) {
      try {
        await EmailService.sendWorkgroupMemberRemoved({
          toEmail: user.email,
          toName: `${user.first_name} ${user.last_name}`,
          workgroupName: wg.rows[0].name,
          groupEmail: wg.rows[0].group_email,
          notificationSetting: wg.rows[0].notification_setting,
        });
      } catch (emailErr) {
        console.warn('[WORKGROUPS] removal email failed:', emailErr.message);
      }
    }

    res.json({ success: true, removed: users.rows.length });
  } catch (err) {
    console.error('[WORKGROUPS] remove members error:', err.message);
    res.status(500).json({ error: 'Failed to remove members' });
  }
});

// ── Identity + Workgroup picker (used across the whole app) ───────────────────
module.exports = router;
