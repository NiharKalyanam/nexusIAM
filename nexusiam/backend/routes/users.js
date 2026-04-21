const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/database');
const logger = require('../config/logger');
const { authenticate, auditLog } = require('../middleware/auth');
const EmailService = require('../services/email/EmailService');
const ProvisioningEngine = require('../services/provisioning/ProvisioningEngine');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { validatePassword } = require('./passwordPolicy');

// Photo upload config
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = '/app/plugins/photos';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uid = req.user?.id || 'unknown';
    cb(null, `user-${uid}-${Date.now()}${ext}`);
  }
});
const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// GET /users
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 25, search, status, org_id } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE u.tenant_id = $1';
    const params = [req.tenantId];
    let idx = 2;
    if (search) { where += ` AND (u.username ILIKE $${idx} OR u.email ILIKE $${idx} OR u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (status) { where += ` AND u.status = $${idx}`; params.push(status); idx++; }
    if (org_id) { where += ` AND u.org_id = $${idx}`; params.push(org_id); idx++; }
    const countResult = await db.query(`SELECT COUNT(*) FROM users u ${where}`, params);
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.display_name,
              u.status, u.department, u.title, u.last_login, u.mfa_enabled, u.source,
              u.created_at, u.employee_id, o.name as org_name,
              u.correlated, u.last_refresh, u.risk_score, u.user_type,
              u.identity_attributes,
              COALESCE(
                (SELECT jsonb_agg(uc.capability_key)
                   FROM user_capabilities uc
                  WHERE uc.user_id = u.id AND uc.tenant_id = u.tenant_id),
                u.capabilities,
                '[]'::jsonb
              ) AS capabilities,
              m.first_name || ' ' || m.last_name AS manager_name,
              array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) as roles
       FROM users u
       LEFT JOIN organizations o ON o.id=u.org_id
       LEFT JOIN users m ON m.id = u.manager_id
       LEFT JOIN user_roles ur ON ur.user_id=u.id AND ur.status='active'
       LEFT JOIN roles r ON r.id=ur.role_id
       ${where} GROUP BY u.id, o.name, m.first_name, m.last_name ORDER BY u.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );
    const total = parseInt(countResult.rows[0].count);
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('GET /users failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /users — create + welcome email
router.post('/', authenticate, auditLog('user.create'), async (req, res) => {
  try {
    const { username, email, first_name, last_name, department, title, org_id, employee_id, send_welcome, password } = req.body;
    if (!username || !email) return res.status(400).json({ error: 'Username and email required' });

    // Get password to use - custom or generated
    let finalPassword = password;
    if (finalPassword) {
      // Validate against password policy
      const { rows: policyRows } = await db.query('SELECT * FROM password_policies WHERE tenant_id=$1', [req.tenantId]);
      const policy = policyRows[0];
      if (policy) {
        const errors = validatePassword(finalPassword, policy);
        if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });
      }
    } else {
      finalPassword = generateTempPassword();
    }

    const hash = await bcrypt.hash(finalPassword, 12);
    const { rows } = await db.query(
      `INSERT INTO users (tenant_id, org_id, username, email, password_hash, first_name, last_name, department, title, employee_id, display_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.tenantId, org_id, username, email, hash, first_name, last_name, department, title, employee_id, `${first_name||''} ${last_name||''}`.trim()]
    );
    const { password_hash, ...user } = rows[0];

    // ── EMAIL: welcome email with temp password ──────────────────────────────
    if (send_welcome !== false) {
      const { rows: tenantRows } = await db.query('SELECT slug FROM tenants WHERE id=$1', [req.tenantId]);
      EmailService.sendWelcomeEmail({
        user: rows[0], tempPassword: finalPassword,
        tenantSlug: tenantRows[0]?.slug || 'demo',
      }).catch(e => logger.warn('[EMAIL] welcome failed', { error: e.message }));
    }

    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// GET /users/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.*, o.name as org_name,
              json_agg(DISTINCT jsonb_build_object('id',r.id,'name',r.name,'type',r.type,'expires_at',ur.expires_at)) FILTER (WHERE r.id IS NOT NULL) as roles
       FROM users u
       LEFT JOIN organizations o ON o.id=u.org_id
       LEFT JOIN user_roles ur ON ur.user_id=u.id AND ur.status='active'
       LEFT JOIN roles r ON r.id=ur.role_id
       WHERE u.id=$1 AND u.tenant_id=$2 GROUP BY u.id, o.name`,
      [req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const { password_hash, mfa_secret, ...user } = rows[0];
    res.json(user);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch user' }); }
});


// GET /users/:id/accounts
router.get('/:id/accounts', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT al.*, c.name AS connector_name, c.type AS connector_type,
              COALESCE(aic.access_count, 0) AS access_count,
              COALESCE(aic.access_items, '[]'::jsonb) AS access_items
         FROM account_links al
         LEFT JOIN connectors c ON c.id = al.connector_id
         LEFT JOIN (
           SELECT aai.account_link_id,
                  COUNT(*) AS access_count,
                  jsonb_agg(jsonb_build_object('type', aai.access_type, 'value', aai.access_value, 'display_name', aai.display_name) ORDER BY aai.access_type, aai.display_name) AS access_items
             FROM account_access_items aai
            GROUP BY aai.account_link_id
         ) aic ON aic.account_link_id = al.id
        WHERE al.user_id = $1 AND al.tenant_id = $2
        ORDER BY c.name, al.account_name`,
      [req.params.id, req.tenantId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch linked accounts' });
  }
});

// PUT /users/:id — if deactivating, deprovision from all connectors
router.put('/:id', authenticate, auditLog('user.update'), async (req, res) => {
  try {
    const { first_name, last_name, department, title, status, org_id, phone, location, attributes } = req.body;
    // Fetch current status before update
    const { rows: before } = await db.query('SELECT * FROM users WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (!before.length) return res.status(404).json({ error: 'User not found' });
    const wasActive = before[0].status === 'active';

    const { rows } = await db.query(
      `UPDATE users SET first_name=$1, last_name=$2, department=$3, title=$4, status=$5,
       org_id=$6, phone=$7, location=$8, attributes=$9, display_name=$10, updated_at=NOW()
       WHERE id=$11 AND tenant_id=$12 RETURNING *`,
      [first_name, last_name, department, title, status, org_id, phone, location,
       JSON.stringify(attributes || {}), `${first_name||''} ${last_name||''}`.trim(), req.params.id, req.tenantId]
    );
    const { password_hash, mfa_secret, ...user } = rows[0];

    // ── DEPROVISION: if account just deactivated, push to all connectors ────
    if (wasActive && status === 'inactive') {
      const { rows: connectors } = await db.query(
        `SELECT * FROM connectors WHERE tenant_id=$1 AND status='connected'`,
        [req.tenantId]
      );
      const deprovisionedFrom = [];
      for (const connector of connectors) {
        try {
          // Push updated (inactive) user to connected apps
          await ProvisioningEngine.executeSync(connector.id, 'push', { userId: req.params.id });
          deprovisionedFrom.push(connector.name);
        } catch (e) {
          logger.warn(`Deprovision failed for ${connector.name}`, { error: e.message });
        }
      }

      // ── EMAIL: notify IT admin of deprovisioning ──────────────────────────
      EmailService.sendUserDeprovisioned({
        user: rows[0],
        deactivatedBy: req.user?.username || 'Admin',
        connectorsSynced: deprovisionedFrom,
        reason: req.body.deactivation_reason || 'Administrative action',
      }).catch(e => logger.warn('[EMAIL] deprovision failed', { error: e.message }));

      // Revoke all active roles
      await db.query(`UPDATE user_roles SET status='revoked', updated_at=NOW() WHERE user_id=$1 AND status='active'`, [req.params.id]);
    }

    res.json(user);
  } catch (err) {
    logger.error('PUT /users/:id failed', { error: err.message });
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// GET /users/:id/roles — fetch all roles with type, inherited IT roles, and entitlements
router.get('/:id/roles', authenticate, async (req, res) => {
  try {
    // Get all directly assigned active roles
    const { rows: userRoles } = await db.query(`
      SELECT r.id, r.name, r.description, r.type, r.risk_level,
             ur.assigned_by, ur.expires_at, ur.assigned_at,
             COALESCE(u.first_name || ' ' || u.last_name, u.username) AS assigned_by_name
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        LEFT JOIN users u ON u.id = ur.assigned_by
       WHERE ur.user_id = $1 AND ur.tenant_id = $2 AND ur.status = 'active'
       ORDER BY r.type, r.name
    `, [req.params.id, req.tenantId]);

    // For each role, get direct entitlements
    const rolesWithDetails = await Promise.all(userRoles.map(async (role) => {
      // Get direct entitlements on this role
      const { rows: directEnts } = await db.query(`
        SELECT e.id, e.name, e.type, e.value, e.description,
               COALESCE(e.display_value, e.name) AS display_name,
               a.name AS application_name
          FROM role_entitlements re
          JOIN entitlements e ON e.id = re.entitlement_id AND e.tenant_id = $2
          LEFT JOIN applications a ON a.id = e.application_id
         WHERE re.role_id = $1
         ORDER BY a.name, e.name
      `, [role.id, req.tenantId]);

      // Get child IT roles (via role_inheritance) with their entitlements
      const { rows: childRoles } = await db.query(`
        SELECT r.id, r.name, r.description, r.type
          FROM role_inheritance ri
          JOIN roles r ON r.id = ri.child_role_id
         WHERE ri.parent_role_id = $1 AND ri.tenant_id = $2
         ORDER BY r.name
      `, [role.id, req.tenantId]);

      const childRolesWithEnts = await Promise.all(childRoles.map(async (cr) => {
        const { rows: crEnts } = await db.query(`
          SELECT e.id, e.name, e.type, e.value, e.description,
                 COALESCE(e.display_value, e.name) AS display_name,
                 a.name AS application_name
            FROM role_entitlements re
            JOIN entitlements e ON e.id = re.entitlement_id AND e.tenant_id = $2
            LEFT JOIN applications a ON a.id = e.application_id
           WHERE re.role_id = $1
           ORDER BY a.name, e.name
        `, [cr.id, req.tenantId]);
        return { ...cr, entitlements: crEnts };
      }));

      return { ...role, entitlements: directEnts, child_roles: childRolesWithEnts };
    }));

    res.json({ data: rolesWithDetails, total: rolesWithDetails.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user roles: ' + err.message });
  }
});

// POST /users/:id/roles — assign roles + provision
router.post('/:id/roles', authenticate, auditLog('user.roles.assign'), async (req, res) => {
  try {
    const { roleIds, justification, expiresAt } = req.body;
    const results = [];
    const roleNames = [];
    for (const roleId of roleIds) {
      const { rows } = await db.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id, assigned_by, justification, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, role_id) DO UPDATE SET status='active', expires_at=$6 RETURNING *`,
        [req.params.id, roleId, req.tenantId, req.user.id, justification, expiresAt || null]
      );
      results.push(rows[0]);
      const rn = await db.query('SELECT name FROM roles WHERE id=$1', [roleId]);
      if (rn.rows[0]) roleNames.push(rn.rows[0].name);
    }

    // ── PROVISION: push to connected apps ────────────────────────────────────
    const { rows: connectors } = await db.query(
      `SELECT * FROM connectors WHERE tenant_id=$1 AND status='connected'`,
      [req.tenantId]
    );
    const provisionedApps = [];
    for (const connector of connectors) {
      try {
        await ProvisioningEngine.executeSync(connector.id, 'push', { userId: req.params.id });
        provisionedApps.push(connector.name);
      } catch (e) {
        logger.warn(`Role provision push failed for ${connector.name}`, { error: e.message });
      }
    }

    // ── EMAIL: notify user of access provisioned ──────────────────────────
    const user = (await db.query('SELECT * FROM users WHERE id=$1', [req.params.id])).rows[0];
    if (user) {
      EmailService.sendAccessProvisioned({
        user, role: roleNames.join(', '),
        applications: provisionedApps,
        provisionedBy: req.user?.username || 'Admin',
      }).catch(() => {});
    }

    res.json({ message: 'Roles assigned', assignments: results });
  } catch (err) { res.status(500).json({ error: 'Failed to assign roles' }); }
});

// DELETE /users/:id/roles/:roleId — revoke role + deprovision
router.delete('/:id/roles/:roleId', authenticate, auditLog('user.roles.revoke'), async (req, res) => {
  try {
    const { rows: roleRows } = await db.query('SELECT name FROM roles WHERE id=$1', [req.params.roleId]);
    await db.query(
      `UPDATE user_roles SET status='revoked', updated_at=NOW() WHERE user_id=$1 AND role_id=$2 AND tenant_id=$3`,
      [req.params.id, req.params.roleId, req.tenantId]
    );

    // Push deprovisioning to connected apps
    const { rows: connectors } = await db.query(
      `SELECT * FROM connectors WHERE tenant_id=$1 AND status='connected'`, [req.tenantId]
    );
    for (const connector of connectors) {
      ProvisioningEngine.executeSync(connector.id, 'push', { userId: req.params.id }).catch(() => {});
    }

    // ── EMAIL: notify user of access revocation ───────────────────────────
    const user = (await db.query('SELECT * FROM users WHERE id=$1', [req.params.id])).rows[0];
    if (user && roleRows[0]) {
      EmailService.sendAccessDeprovisioned({
        user, role: roleRows[0].name,
        reason: 'Role revoked by administrator',
        revokedBy: req.user?.username || 'Admin',
        applications: [],
      }).catch(() => {});
    }

    res.json({ message: 'Role revoked' });
  } catch (err) { res.status(500).json({ error: 'Failed to revoke role' }); }
});

// DELETE /users/:id — deactivate (soft) or hard delete based on ?hard=true
router.delete('/:id', authenticate, auditLog('user.delete'), async (req, res) => {
  try {
    const hard = req.query.hard === 'true';
    const justification = req.body?.justification || '';

    const { rows: userRows } = await db.query(`SELECT * FROM users WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenantId]);
    if (!userRows.length) return res.status(404).json({ error: 'Not found' });
    const user = userRows[0];

    if (hard) {
      // Hard delete: clear ALL FK references first in dependency order
      await db.query('DELETE FROM user_roles WHERE user_id=$1', [req.params.id]);
      await db.query('DELETE FROM user_entitlements WHERE user_id=$1', [req.params.id]).catch(() => {});
      await db.query('DELETE FROM account_access_items WHERE tenant_id=$1 AND account_link_id IN (SELECT id FROM account_links WHERE user_id=$2)', [req.tenantId, req.params.id]).catch(() => {});
      await db.query('DELETE FROM account_links WHERE user_id=$1', [req.params.id]);
      await db.query('DELETE FROM notifications WHERE user_id=$1', [req.params.id]).catch(() => {});
      await db.query('UPDATE work_items SET assignee_id=NULL, acted_by=NULL WHERE assignee_id=$1 OR acted_by=$1', [req.params.id]).catch(() => {});
      await db.query('UPDATE provisioning_transactions SET target_user_id=NULL WHERE target_user_id=$1', [req.params.id]).catch(() => {});
      await db.query('UPDATE access_requests SET requester_id=NULL WHERE requester_id=$1', [req.params.id]).catch(() => {});
      await db.query('UPDATE access_requests SET target_user_id=NULL WHERE target_user_id=$1', [req.params.id]).catch(() => {});
      await db.query('UPDATE access_requests SET resolved_by=NULL WHERE resolved_by=$1', [req.params.id]).catch(() => {});
      await db.query('UPDATE certifications SET reviewer_id=NULL WHERE reviewer_id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]).catch(() => {});
      await db.query('UPDATE certification_items SET decided_by=NULL WHERE decided_by=$1', [req.params.id]).catch(() => {});
      await db.query('UPDATE certification_items SET subject_user_id=NULL WHERE subject_user_id=$1', [req.params.id]).catch(() => {});
      await db.query('UPDATE users SET manager_id=NULL WHERE manager_id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]).catch(() => {});
      await db.query('DELETE FROM workgroup_members WHERE user_id=$1', [req.params.id]).catch(() => {});
      await db.query('DELETE FROM audit_logs WHERE user_id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]).catch(() => {});
      await db.query('DELETE FROM users WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
      EmailService.sendUserDeprovisioned({ user, deactivatedBy: req.user?.username || 'Admin', connectorsSynced: [], reason: 'HARD DELETE — ' + (justification || 'Administrative removal') }).catch(() => {});
      return res.json({ message: 'User permanently deleted', hard: true });
    }

    // Soft deactivate: mark inactive, revoke roles, then async deprovision (non-blocking)
    await db.query(`UPDATE users SET status='inactive', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenantId]);
    await db.query(`UPDATE user_roles SET status='revoked', updated_at=NOW() WHERE user_id=$1 AND status='active'`, [req.params.id]);
    res.json({ message: 'User deactivated', hard: false });

    // Async deprovision after response sent — non-blocking
    setImmediate(async () => {
      const deprovisioned = [];
      try {
        const { rows: conns } = await db.query(`SELECT * FROM connectors WHERE tenant_id=$1 AND status='connected'`, [req.tenantId]);
        for (const conn of conns) {
          try { await ProvisioningEngine.executeSync(conn.id, 'push', { userId: req.params.id }); deprovisioned.push(conn.name); }
          catch (e) { logger.warn('Deprovision failed ' + conn.name, { error: e.message }); }
        }
      } catch (e) { logger.warn('Async deprovision error', { error: e.message }); }
      EmailService.sendUserDeprovisioned({ user, deactivatedBy: req.user?.username || 'Admin', connectorsSynced: deprovisioned, reason: justification || 'Deactivated via NexusIAM admin' }).catch(() => {});
    });
  } catch (err) {
    logger.error('User delete failed', { error: err.message });
    res.status(500).json({ error: 'Failed to process user deletion' });
  }
});


// ── Per-user entitlements via account_links -> account_access_items ──────────
router.get('/:id/entitlements', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT
        COALESCE(e.id, md5(COALESCE(app.id::text,'') || ':' || aai.access_type || ':' || aai.access_value)::uuid) AS id,
        COALESCE(e.name, aai.display_name, aai.access_value) AS name,
        aai.access_type AS type,
        aai.access_value AS value,
        COALESCE(e.description, aai.display_name) AS description,
        COALESCE(app.name, cn.name, 'Unknown') AS application_name,
        COALESCE((e.metadata->>'requestable')::boolean, false) AS requestable,
        COALESCE(e.elevated_access, false) AS elevated_access,
        COALESCE(e.metadata->>'classification', '') AS classification,
        aai.last_seen_at
      FROM account_links al
      JOIN account_access_items aai ON aai.account_link_id = al.id AND aai.tenant_id = al.tenant_id
      LEFT JOIN applications app ON app.tenant_id = al.tenant_id
        AND COALESCE(app.metadata->>'connector_id', app.provisioning_config->>'connector_id') = al.connector_id::text
      LEFT JOIN connectors cn ON cn.id = al.connector_id
      LEFT JOIN entitlements e ON e.tenant_id = al.tenant_id
        AND e.application_id = app.id
        AND COALESCE(e.type, '') = COALESCE(aai.access_type, '')
        AND COALESCE(e.value, '') = COALESCE(aai.access_value, '')
      WHERE al.tenant_id = $1
        AND al.user_id = $2
        AND al.object_type = 'account'
      ORDER BY application_name, name
      LIMIT 200
    `, [req.tenantId, req.params.id]);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error('[USERS] entitlements error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user entitlements' });
  }
});

// POST /users/me/photo - upload current user's photo
router.post('/me/photo', authenticate, photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No valid image file provided' });
    // Use public endpoint - no auth token needed for img src tags
    const photoUrl = `/api/v1/users/photos/${req.file.filename}`;
    await db.query(
      'UPDATE users SET photo_url=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [photoUrl, req.user.id, req.tenantId]
    );
    res.json({ photo_url: photoUrl });
  } catch (err) {
    logger.error('[USERS] photo upload error', { error: err.message });
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// GET /users/photos/:filename - serve photo files publicly (no auth - used by img src)
router.get('/photos/:filename', (req, res) => {
  // Strip any query string that might be part of the param
  const file = req.params.filename.split('?')[0];
  if (!file || file.includes('..') || file.includes('/')) return res.status(400).end();
  const filePath = path.join('/app/plugins/photos', file);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// PUT /users/me/theme - save theme preference per user
router.put('/me/theme', authenticate, async (req, res) => {
  try {
    const { theme } = req.body;
    if (!['dark', 'light'].includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
    await db.query(
      'UPDATE users SET theme=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [theme, req.user.id, req.tenantId]
    );
    res.json({ theme });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save theme' });
  }
});

module.exports = router;
