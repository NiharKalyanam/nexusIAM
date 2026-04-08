const jwt = require('jsonwebtoken');
const db = require('../config/database');
const redis = require('../config/redis');
const logger = require('../config/logger');

// ── Security settings cache (1 min TTL to avoid DB hit on every request) ────
const _settingsCache = new Map();
async function getSecuritySettings(tenantId) {
  const cached = _settingsCache.get(tenantId);
  if (cached && cached.ts > Date.now() - 5000) return cached.data; // 5s cache
  try {
    const { rows } = await db.query(
      'SELECT session_idle_timeout_mins, session_max_lifetime_mins, jwt_access_token_ttl_mins, jwt_refresh_token_ttl_days FROM security_settings WHERE tenant_id=$1',
      [tenantId]
    );
    const data = rows[0] || { session_idle_timeout_mins: 30, session_max_lifetime_mins: 480 };
    _settingsCache.set(tenantId, { data, ts: Date.now() });
    return data;
  } catch {
    return { session_idle_timeout_mins: 30, session_max_lifetime_mins: 480 };
  }
}

// ── API Key authentication (for external callers using nxk_... keys) ─────────
const authenticateApiKey = async (keyId, rawSecret, tenantId) => {
  const { rows } = await db.query(
    `SELECT * FROM api_credentials
      WHERE key_id = $1 AND tenant_id = $2 AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [keyId, tenantId]
  );
  if (!rows.length) return null;
  const match = await require('bcrypt').compare(rawSecret, rows[0].key_secret_hash);
  if (!match) return null;
  // Update last_used_at async
  db.query('UPDATE api_credentials SET last_used_at=NOW() WHERE id=$1', [rows[0].id]).catch(() => {});
  return rows[0];
};

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Check if this is an API key (format: nxk_<keyid>:<rawsecret>)
    if (token.startsWith('nxk_')) {
      const colonIdx = token.indexOf(':');
      if (colonIdx === -1) return res.status(401).json({ error: 'Invalid API key format' });
      const keyId = token.slice(0, colonIdx);
      const rawSecret = token.slice(colonIdx + 1);
      // Need tenant — from header or first segment; for API keys require X-Tenant-ID header
      const tenantId = req.headers['x-tenant-id'] || '00000000-0000-0000-0000-000000000001';
      const apiKey = await authenticateApiKey(keyId, rawSecret, tenantId);
      if (!apiKey) return res.status(401).json({ error: 'Invalid or expired API key' });
      // Synthesize a req.user from the API key
      req.user = { id: apiKey.created_by || apiKey.id, tenant_id: tenantId, username: `apikey:${apiKey.name}`, email: '', status: 'active', _isApiKey: true, _apiKeyName: apiKey.name };
      req.tenantId = tenantId;
      return next();
    }

    // Check token blacklist in Redis
    const blacklisted = await redis.get(`blacklist:${token}`);
    if (blacklisted) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user from DB
    const { rows } = await db.query(
      'SELECT id, tenant_id, username, email, status, first_name, last_name FROM users WHERE id = $1 AND status = $2',
      [decoded.userId, 'active']
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = rows[0];
    req.tenantId = rows[0].tenant_id;

    // ── Session enforcement ──────────────────────────────────────────────────
    try {
      const settings = await getSecuritySettings(rows[0].tenant_id);
      const idleMins   = settings.session_idle_timeout_mins  || 30;
      const maxMins    = settings.session_max_lifetime_mins   || 480;
      const sessionKey = `session:${token.slice(-16)}`; // use last 16 chars as key
      const issuedAt   = decoded.iat || 0;
      const nowSecs    = Math.floor(Date.now() / 1000);

      // Check max lifetime (absolute — from token issuance)
      const ageMinutes = (nowSecs - issuedAt) / 60;
      if (ageMinutes > maxMins) {
        await redis.setEx(`blacklist:${token}`, 60, '1');
        return res.status(401).json({ error: 'Session expired — maximum lifetime reached', code: 'SESSION_MAX_LIFETIME' });
      }

      // Check idle timeout (from last activity)
      const lastActivity = await redis.get(sessionKey);
      if (lastActivity) {
        const idleMinutes = (nowSecs - parseInt(lastActivity)) / 60;
        if (idleMinutes > idleMins) {
          await redis.setEx(`blacklist:${token}`, 300, '1');
          return res.status(401).json({ error: 'Session expired — idle timeout', code: 'SESSION_IDLE_TIMEOUT' });
        }
      }

      // Update last activity (fire and forget)
      redis.setEx(sessionKey, maxMins * 60, String(nowSecs)).catch(() => {});
    } catch (sessionErr) {
      // Never block requests due to session check errors
      logger.warn('Session check error', { error: sessionErr.message });
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    logger.error('Auth middleware error', { error: err.message });
    res.status(500).json({ error: 'Authentication error' });
  }
};

const authorize = (...roles) => async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND ur.status = 'active'`,
      [req.user.id]
    );
    const userRoles = rows.map(r => r.name);
    const hasRole = roles.some(role => userRoles.includes(role));
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.userRoles = userRoles;
    next();
  } catch (err) {
    logger.error('Authorization error', { error: err.message });
    res.status(500).json({ error: 'Authorization error' });
  }
};

const auditLog = (action) => async (req, res, next) => {
  const originalSend = res.json.bind(res);
  const start = Date.now();
  res.json = async (body) => {
    try {
      await db.query(
        `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, ip_address, user_agent, status, duration_ms, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          req.tenantId,
          req.user?.id,
          action,
          req.params.id ? 'resource' : 'collection',
          req.params.id || null,
          req.ip,
          req.get('user-agent'),
          res.statusCode < 400 ? 'success' : 'failure',
          Date.now() - start,
          req.headers['x-correlation-id'] || null,
        ]
      );
    } catch (e) {
      logger.error('Audit log error', { error: e.message });
    }
    return originalSend(body);
  };
  next();
};

module.exports = { authenticate, authorize, auditLog, authenticateApiKey };
