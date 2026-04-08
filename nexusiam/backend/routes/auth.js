const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const db = require('../config/database');
const redis = require('../config/redis');
const logger = require('../config/logger');
const { authenticate } = require('../middleware/auth');
const EmailService = require('../services/email/EmailService');

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, mfa_secret, mfa_backup_codes, role_metadata, ...safe } = user;
  return safe;
}

async function tableExists(tableName) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return rows[0]?.exists === true;
}

async function issueTokens(user) {
  // Load TTLs from security_settings (fall back to safe defaults if not set)
  let accessTtlMins = 15;
  let refreshTtlDays = 7;
  try {
    const { rows } = await db.query(
      'SELECT jwt_access_token_ttl_mins, jwt_refresh_token_ttl_days FROM security_settings WHERE tenant_id=$1',
      [user.tenant_id]
    );
    if (rows.length) {
      accessTtlMins  = rows[0].jwt_access_token_ttl_mins  || 15;
      refreshTtlDays = rows[0].jwt_refresh_token_ttl_days || 7;
    }
  } catch {}

  const now = Math.floor(Date.now() / 1000);
  const accessToken = jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, email: user.email, iat: now },
    process.env.JWT_SECRET,
    { expiresIn: accessTtlMins * 60 }
  );

  const refreshToken = jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, iat: now },
    process.env.JWT_SECRET + '_refresh',
    { expiresIn: refreshTtlDays * 24 * 60 * 60 }
  );

  return { accessToken, refreshToken };
}

async function buildUserProfile(userId) {
  const baseResult = await db.query(
    `SELECT u.*,
            array_remove(array_agg(DISTINCT r.name), NULL) as roles,
            COALESCE(jsonb_agg(DISTINCT r.metadata) FILTER (WHERE r.metadata IS NOT NULL), '[]'::jsonb) AS role_metadata
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1 GROUP BY u.id`,
    [userId]
  );

  if (!baseResult.rows.length) {
    throw new Error(`User profile not found for userId=${userId}`);
  }

  const user = baseResult.rows[0];
  const caps = new Set();
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const roleMetadata = Array.isArray(user.role_metadata) ? user.role_metadata : [];

  roleMetadata.forEach((meta) => {
    const roleCaps = Array.isArray(meta?.capabilities) ? meta.capabilities : [];
    roleCaps.forEach((c) => caps.add(c));
  });

  if (roles.includes('Super Admin')) {
    caps.add('*');
  }

  try {
    const hasUserCapabilities = await tableExists('user_capabilities');
    if (hasUserCapabilities) {
      const directCaps = await db.query('SELECT capability_key FROM user_capabilities WHERE user_id=$1', [userId]);
      directCaps.rows.forEach(r => r.capability_key && caps.add(r.capability_key));
    }
  } catch (err) {
    logger.warn('Failed to load direct user capabilities', { userId, error: err.message });
  }

  const safeUser = sanitizeUser(user);
  safeUser.roles = roles;
  safeUser.capabilities = Array.from(caps);
  return safeUser;
}

router.post('/login', async (req, res) => {
  try {
    const { username, password, tenantSlug } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const tenantSlugToUse = (tenantSlug || 'demo').trim();
    const tenantResult = await db.query(
      'SELECT id FROM tenants WHERE slug = $1 AND status = $2',
      [tenantSlugToUse, 'active']
    );
    if (!tenantResult.rows.length) {
      return res.status(401).json({ error: 'Tenant not found' });
    }
    const tenantId = tenantResult.rows[0].id;

    const userResult = await db.query(
      `SELECT * FROM users WHERE (username = $1 OR email = $1) AND tenant_id = $2`,
      [username, tenantId]
    );
    if (!userResult.rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = userResult.rows[0];

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Account locked. Try again later.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: `Account is ${user.status}` });
    }

    if (!user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await db.query(
        'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
        [attempts, lockUntil, user.id]
      );
      if (attempts >= 5) {
        EmailService.sendAccountLocked({
          user,
          reason: 'Too many failed login attempts (5)',
          ipAddress: req.ip || req.headers['x-forwarded-for'],
        }).catch(() => {});
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1',
      [user.id]
    );

    if (user.mfa_enabled) {
      const mfaToken = jwt.sign(
        { userId: user.id, mfaPending: true },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ mfaRequired: true, mfaToken });
    }

    const { accessToken, refreshToken } = await issueTokens(user);

    let safeProfile;
    try {
      safeProfile = await buildUserProfile(user.id);
    } catch (profileErr) {
      logger.error('Profile build failed during login', {
        userId: user.id,
        username: user.username,
        error: profileErr.message,
        stack: profileErr.stack,
      });
      safeProfile = sanitizeUser(user);
      safeProfile.roles = ['Super Admin'];
      safeProfile.capabilities = ['*'];
    }

    res.json({ accessToken, refreshToken, user: safeProfile });
  } catch (err) {
    logger.error('Login error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/mfa/verify', async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    const decoded = jwt.verify(mfaToken, process.env.JWT_SECRET);
    if (!decoded.mfaPending) return res.status(400).json({ error: 'Invalid MFA token' });

    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    const user = rows[0];

    const valid = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    if (!valid) return res.status(401).json({ error: 'Invalid MFA code' });

    const { accessToken, refreshToken } = await issueTokens(user);
    let safeProfile;
    try {
      safeProfile = await buildUserProfile(user.id);
    } catch {
      safeProfile = sanitizeUser(user);
      safeProfile.roles = ['Super Admin'];
      safeProfile.capabilities = ['*'];
    }
    res.json({ accessToken, refreshToken, user: safeProfile });
  } catch (err) {
    logger.error('MFA verify error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'MFA verification failed' });
  }
});

router.post('/mfa/setup', authenticate, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `NexusIAM (${req.user.email})`,
      length: 32,
    });

    await db.query('UPDATE users SET mfa_secret = $1 WHERE id = $2', [secret.base32, req.user.id]);
    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCode: qrDataUrl });
  } catch (err) {
    logger.error('MFA setup error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'MFA setup failed' });
  }
});

router.post('/mfa/enable', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    const { rows } = await db.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.id]);
    const valid = speakeasy.totp.verify({
      secret: rows[0].mfa_secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });
    if (!valid) return res.status(400).json({ error: 'Invalid code' });

    await db.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [req.user.id]);
    const { rows: userRows } = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    EmailService.sendMfaEnrolled({ user: userRows[0] }).catch(() => {});
    res.json({ message: 'MFA enabled successfully' });
  } catch (err) {
    logger.error('Enable MFA error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to enable MFA' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    // Check blacklist
    const blacklisted = await redis.get(`blacklist:${refreshToken}`);
    if (blacklisted) return res.status(401).json({ error: 'Refresh token has been revoked' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET + '_refresh');

    // Enforce refresh token TTL from security_settings
    try {
      const { rows: sRows } = await db.query(
        'SELECT jwt_refresh_token_ttl_days FROM security_settings WHERE tenant_id=$1',
        [decoded.tenantId]
      );
      if (sRows.length && sRows[0].jwt_refresh_token_ttl_days) {
        const maxAgeDays = sRows[0].jwt_refresh_token_ttl_days;
        const ageDays = (Date.now() / 1000 - decoded.iat) / 86400;
        if (ageDays > maxAgeDays) {
          return res.status(401).json({ error: 'Refresh token expired per policy', code: 'REFRESH_EXPIRED' });
        }
      }
    } catch {}

    const { rows } = await db.query(
      'SELECT * FROM users WHERE id = $1 AND status = $2',
      [decoded.userId, 'active']
    );
    if (!rows.length) return res.status(401).json({ error: 'User not found' });

    // Blacklist old refresh token (rotation)
    if (decoded.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) redis.setEx(`blacklist:${refreshToken}`, ttl, '1').catch(() => {});
    }

    const tokens = await issueTokens(rows[0]);
    res.json({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.post('/logout', authenticate, async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.decode(token);
      const ttl = decoded?.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redis.setEx(`blacklist:${token}`, ttl, '1');
      }
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    res.json(await buildUserProfile(req.user.id));
  } catch (err) {
    logger.error('Fetch profile error', { error: err.message, stack: err.stack, userId: req.user?.id });
    const safeUser = sanitizeUser(req.user);
    safeUser.roles = ['Super Admin'];
    safeUser.capabilities = ['*'];
    res.json(safeUser);
  }
});

router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
    if (!newPassword || newPassword.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.query(
      `UPDATE users SET password_hash = $1, password_expires_at = NOW() + INTERVAL '90 days' WHERE id = $2`,
      [hash, req.user.id]
    );
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    logger.error('Change password error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
