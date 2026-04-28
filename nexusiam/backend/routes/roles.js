// roles.js
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { search, type } = req.query;
    let where = 'WHERE r.tenant_id = $1';
    const params = [req.tenantId];
    if (search) { where += ' AND r.name ILIKE $2'; params.push(`%${search}%`); }
    if (type && !search) { where += ' AND r.type = $2'; params.push(type); }

    const { rows } = await db.query(
      `SELECT r.*, COUNT(DISTINCT ur.user_id) as user_count,
              COUNT(DISTINCT re.entitlement_id) as entitlement_count
       FROM roles r
       LEFT JOIN user_roles ur ON ur.role_id = r.id AND ur.status = 'active'
       LEFT JOIN role_entitlements re ON re.role_id = r.id
       ${where} GROUP BY r.id ORDER BY r.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

router.post('/', authenticate, auditLog('role.create'), async (req, res) => {
  try {
    const { name, description, type, risk_level, owner_id } = req.body;
    const { rows } = await db.query(
      `INSERT INTO roles (tenant_id, name, description, type, risk_level, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.tenantId, name, description, type || 'business', risk_level || 1, owner_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Role name already exists' });
    res.status(500).json({ error: 'Failed to create role' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*,
              json_agg(DISTINCT jsonb_build_object('id', e.id, 'name', e.name, 'type', e.type)) FILTER (WHERE e.id IS NOT NULL) as entitlements
       FROM roles r
       LEFT JOIN role_entitlements re ON re.role_id = r.id
       LEFT JOIN entitlements e ON e.id = re.entitlement_id
       WHERE r.id = $1 AND r.tenant_id = $2 GROUP BY r.id`,
      [req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Role not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

router.put('/:id', authenticate, auditLog('role.update'), async (req, res) => {
  try {
    const { name, description, type, risk_level } = req.body;
    const { rows } = await db.query(
      `UPDATE roles SET name=$1, description=$2, type=$3, risk_level=$4, updated_at=NOW()
       WHERE id=$5 AND tenant_id=$6 RETURNING *`,
      [name, description, type, risk_level, req.params.id, req.tenantId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

router.delete('/:id', authenticate, auditLog('role.delete'), async (req, res) => {
  try {
    await db.query('DELETE FROM roles WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    res.json({ message: 'Role deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

module.exports = router;

// GET /:id/entitlements
router.get('/:id/entitlements', authenticate, async (req, res) => {
  try {
    // Verify role belongs to tenant
    const { rows: roleCheck } = await db.query('SELECT id FROM roles WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (!roleCheck.length) return res.status(404).json({ error: 'Role not found' });

    const { application_id } = req.query;
    let query = `SELECT e.id, e.name, e.type, e.value, e.description,
              COALESCE(e.display_value, e.name) as display_name,
              a.name as application_name, a.id as application_id
       FROM role_entitlements re
       JOIN entitlements e ON e.id = re.entitlement_id AND e.tenant_id = $2
       LEFT JOIN applications a ON a.id = e.application_id
       WHERE re.role_id = $1`;
    const params = [req.params.id, req.tenantId];
    if (application_id) { query += ` AND e.application_id = $3`; params.push(application_id); }
    query += ` ORDER BY a.name, e.name`;
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch role entitlements: ' + err.message });
  }
});

// POST /:id/entitlements - add entitlement to role
router.post('/:id/entitlements', authenticate, auditLog('role.entitlement.add'), async (req, res) => {
  try {
    const { entitlement_id } = req.body;
    await db.query(
      `INSERT INTO role_entitlements (role_id, entitlement_id, granted_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.params.id, entitlement_id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add entitlement' });
  }
});

// DELETE /:id/entitlements/:entitlementId
router.delete('/:id/entitlements/:entitlementId', authenticate, auditLog('role.entitlement.remove'), async (req, res) => {
  try {
    await db.query(
      'DELETE FROM role_entitlements WHERE role_id=$1 AND entitlement_id=$2',
      [req.params.id, req.params.entitlementId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove entitlement' });
  }
});

// PUT /:id - update with owner support
router.put('/:id/owner', authenticate, auditLog('role.owner.update'), async (req, res) => {
  try {
    const { owner_id } = req.body;
    const { rows } = await db.query(
      'UPDATE roles SET owner_id=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [owner_id, req.params.id, req.tenantId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update owner' });
  }
});

// GET /:id/inherited-roles - get IT roles included in this role
router.get('/:id/inherited-roles', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.name, r.type, r.description, r.risk_level
       FROM role_inheritance ri
       JOIN roles r ON r.id = ri.child_role_id
       WHERE ri.parent_role_id = $1 AND ri.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch inherited roles' }); }
});

// POST /:id/inherited-roles - add IT role to Business/Birthright role
router.post('/:id/inherited-roles', authenticate, auditLog('role.inheritance.add'), async (req, res) => {
  try {
    const { child_role_id } = req.body;
    await db.query(
      `INSERT INTO role_inheritance (parent_role_id, child_role_id, tenant_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.params.id, child_role_id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to add inherited role' }); }
});

// DELETE /:id/inherited-roles/:childId
router.delete('/:id/inherited-roles/:childId', authenticate, auditLog('role.inheritance.remove'), async (req, res) => {
  try {
    await db.query(
      'DELETE FROM role_inheritance WHERE parent_role_id=$1 AND child_role_id=$2 AND tenant_id=$3',
      [req.params.id, req.params.childId, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to remove inherited role' }); }
});

module.exports = router;
