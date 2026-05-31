const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const bcrypt   = require('bcrypt');
const db       = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const logger   = require('../config/logger');

router.use(authenticate);

// ── Vault encryption helpers ──────────────────────────────────────────────────
const VAULT_KEY_HEX = process.env.VAULT_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const VAULT_KEY     = Buffer.from(VAULT_KEY_HEX.padEnd(64, '0').slice(0, 64), 'hex');

function encryptSecret(plaintext) {
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([encrypted, tag]).toString('base64'),
    iv: iv.toString('hex'),
  };
}

function decryptSecret(encryptedB64, ivHex) {
  const buf  = Buffer.from(encryptedB64, 'base64');
  const iv   = Buffer.from(ivHex, 'hex');
  const tag  = buf.slice(buf.length - 16);
  const data = buf.slice(0, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY SETTINGS (session, email, SAML)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/settings', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM security_settings WHERE tenant_id=$1', [req.tenantId]
    );
    if (!rows.length) {
      await db.query('INSERT INTO security_settings (tenant_id) VALUES ($1)', [req.tenantId]);
      return res.json((await db.query('SELECT * FROM security_settings WHERE tenant_id=$1', [req.tenantId])).rows[0]);
    }
    // Never return smtp password — return vault ref only
    const s = { ...rows[0] };
    delete s.email_smtp_pass_vault_ref; // frontend gets vault name, not value
    res.json(s);
  } catch (err) {
    logger.error('[SECURITY] get settings', { error: err.message });
    res.status(500).json({ error: 'Failed to load security settings' });
  }
});

// ── Session settings (only touches session/JWT columns) ─────────────────────
router.put('/settings/session', auditLog('security.session.update'), async (req, res) => {
  try {
    const { session_idle_timeout_mins, session_max_lifetime_mins,
            jwt_access_token_ttl_mins, jwt_refresh_token_ttl_days } = req.body;
    await db.query(
      `INSERT INTO security_settings (tenant_id, session_idle_timeout_mins,
         session_max_lifetime_mins, jwt_access_token_ttl_mins, jwt_refresh_token_ttl_days)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id) DO UPDATE SET
         session_idle_timeout_mins  = EXCLUDED.session_idle_timeout_mins,
         session_max_lifetime_mins  = EXCLUDED.session_max_lifetime_mins,
         jwt_access_token_ttl_mins  = EXCLUDED.jwt_access_token_ttl_mins,
         jwt_refresh_token_ttl_days = EXCLUDED.jwt_refresh_token_ttl_days,
         updated_at = NOW()`,
      [req.tenantId,
       session_idle_timeout_mins ?? 30, session_max_lifetime_mins ?? 480,
       jwt_access_token_ttl_mins ?? 15, jwt_refresh_token_ttl_days ?? 7]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('[SECURITY] session update', { error: err.message });
    res.status(500).json({ error: 'Failed to save session settings' });
  }
});

// ── Email settings (only touches email columns — preserves SMTP creds when switching transports)
router.put('/settings/email', auditLog('security.email.update'), async (req, res) => {
  try {
    const { email_transport, email_smtp_host, email_smtp_port,
            email_smtp_user, email_smtp_pass, email_smtp_from,
            email_smtp_tls, email_file_path } = req.body;

    // Only update vault if a new password was explicitly provided
    let vaultRef = null;
    if (email_smtp_pass && email_smtp_pass.trim()) {
      const { encrypted, iv } = encryptSecret(email_smtp_pass);
      const vaultName = `__smtp_password_${req.tenantId}`;
      await db.query(
        `INSERT INTO credential_vault (tenant_id, name, credential_type, encrypted_value, iv, description, created_by)
         VALUES ($1,$2,'smtp',$3,$4,'Auto-managed SMTP password',$5)
         ON CONFLICT (tenant_id, name) DO UPDATE SET encrypted_value=$3, iv=$4, last_rotated_at=NOW()`,
        [req.tenantId, vaultName, encrypted, iv, req.user.id]
      );
      vaultRef = vaultName;
    }

    // ONLY update fields that were explicitly sent — preserve everything else
    // Transport selector always updates. SMTP fields only update when transport=smtp and value provided.
    await db.query(
      `INSERT INTO security_settings (tenant_id, email_transport, email_smtp_host, email_smtp_port,
         email_smtp_user, email_smtp_pass_vault_ref, email_smtp_from, email_smtp_tls, email_file_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id) DO UPDATE SET
         email_transport           = EXCLUDED.email_transport,
         email_smtp_host           = CASE WHEN $3 IS NOT NULL THEN $3 ELSE security_settings.email_smtp_host END,
         email_smtp_port           = CASE WHEN $4 IS NOT NULL THEN $4 ELSE security_settings.email_smtp_port END,
         email_smtp_user           = CASE WHEN $5 IS NOT NULL THEN $5 ELSE security_settings.email_smtp_user END,
         email_smtp_pass_vault_ref = CASE WHEN $6 IS NOT NULL THEN $6 ELSE security_settings.email_smtp_pass_vault_ref END,
         email_smtp_from           = CASE WHEN $7 IS NOT NULL THEN $7 ELSE security_settings.email_smtp_from END,
         email_smtp_tls            = EXCLUDED.email_smtp_tls,
         email_file_path           = CASE WHEN $9 IS NOT NULL THEN $9 ELSE security_settings.email_file_path END,
         updated_at                = NOW()`,
      [req.tenantId, email_transport ?? 'smtp',
       email_smtp_host || null, email_smtp_port || null,
       email_smtp_user || null, vaultRef,
       email_smtp_from || null, email_smtp_tls ?? true,
       email_file_path || null]
    );

    // Bust email transport cache so new config takes effect immediately
    const { _transportCache } = require('../services/email/EmailService');
    if (_transportCache) _transportCache.delete(req.tenantId);

    res.json({ success: true });
  } catch (err) {
    logger.error('[SECURITY] email update', { error: err.message });
    res.status(500).json({ error: 'Failed to save email settings' });
  }
});

// ── SAML settings (only touches SAML columns) ─────────────────────────────────
router.put('/settings/saml', auditLog('security.saml.update'), async (req, res) => {
  try {
    const { saml_enabled, saml_idp_entity_id, saml_idp_sso_url,
            saml_idp_slo_url, saml_idp_certificate,
            saml_sp_entity_id, saml_attribute_map } = req.body;
    await db.query(
      `INSERT INTO security_settings (tenant_id, saml_enabled, saml_idp_entity_id,
         saml_idp_sso_url, saml_idp_slo_url, saml_idp_certificate,
         saml_sp_entity_id, saml_attribute_map)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id) DO UPDATE SET
         saml_enabled        = EXCLUDED.saml_enabled,
         saml_idp_entity_id  = EXCLUDED.saml_idp_entity_id,
         saml_idp_sso_url    = EXCLUDED.saml_idp_sso_url,
         saml_idp_slo_url    = EXCLUDED.saml_idp_slo_url,
         saml_idp_certificate= EXCLUDED.saml_idp_certificate,
         saml_sp_entity_id   = EXCLUDED.saml_sp_entity_id,
         saml_attribute_map  = EXCLUDED.saml_attribute_map,
         updated_at          = NOW()`,
      [req.tenantId, saml_enabled ?? false, saml_idp_entity_id,
       saml_idp_sso_url, saml_idp_slo_url, saml_idp_certificate,
       saml_sp_entity_id,
       JSON.stringify(saml_attribute_map || { email:'email', firstName:'firstName', lastName:'lastName' })]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('[SECURITY] saml update', { error: err.message });
    res.status(500).json({ error: 'Failed to save SAML settings' });
  }
});

// ── Legacy combined PUT (backward compat — returns success, use scoped endpoints instead)
router.put('/settings', auditLog('security.settings.update'), async (req, res) => {
  res.json({ success: true, message: 'Use /settings/session, /settings/email, or /settings/saml' });
});

// ══════════════════════════════════════════════════════════════════════════════
// API KEYS (inbound)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/api-keys', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ac.*, u.first_name || ' ' || u.last_name AS created_by_name
         FROM api_credentials ac
         LEFT JOIN users u ON u.id = ac.created_by
        WHERE ac.tenant_id = $1
        ORDER BY ac.created_at DESC`,
      [req.tenantId]
    );
    // Never return hash
    res.json(rows.map(r => ({ ...r, key_secret_hash: undefined })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load API keys' });
  }
});

router.post('/api-keys', auditLog('api_key.create'), async (req, res) => {
  try {
    const { name, description, expires_at } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

    // Generate key_id (public) and raw secret (shown once)
    const keyId     = 'nxk_' + crypto.randomBytes(16).toString('hex');
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const hash      = await bcrypt.hash(rawSecret, 10);
    const preview   = rawSecret.slice(-6); // last 6 chars for display

    const { rows } = await db.query(
      `INSERT INTO api_credentials
         (tenant_id, name, description, key_id, key_secret_hash, key_preview, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.tenantId, name.trim(), description || null, keyId, hash, preview,
       expires_at || null, req.user.id]
    );

    // Return the full secret ONCE — never again
    res.status(201).json({
      ...rows[0],
      key_secret_hash: undefined,
      raw_secret: rawSecret, // ← shown once in UI, then discarded
      full_key: `${keyId}:${rawSecret}`, // the string callers put in Authorization header
    });
  } catch (err) {
    logger.error('[SECURITY] create api key', { error: err.message });
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.put('/api-keys/:id/toggle', auditLog('api_key.toggle'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE api_credentials SET is_active = NOT is_active, updated_at = NOW()
        WHERE id=$1 AND tenant_id=$2 RETURNING id, is_active`,
      [req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle API key' });
  }
});

router.delete('/api-keys/:id', auditLog('api_key.delete'), async (req, res) => {
  try {
    await db.query(
      'DELETE FROM api_credentials WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CREDENTIAL VAULT (outbound)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/vault', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT cv.id, cv.name, cv.credential_type, cv.metadata, cv.description,
              cv.is_active, cv.last_rotated_at, cv.created_at,
              u.first_name || ' ' || u.last_name AS created_by_name
         FROM credential_vault cv
         LEFT JOIN users u ON u.id = cv.created_by
        WHERE cv.tenant_id = $1 AND cv.name NOT LIKE '__smtp_%'
        ORDER BY cv.name`,
      [req.tenantId]
    );
    // Never return encrypted_value or iv
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load vault' });
  }
});

router.post('/vault', auditLog('vault.create'), async (req, res) => {
  try {
    const { name, credential_type, secret_value, description, metadata } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    if (!secret_value?.trim()) return res.status(400).json({ error: 'Secret value required' });

    const { encrypted, iv } = encryptSecret(secret_value);
    const { rows } = await db.query(
      `INSERT INTO credential_vault
         (tenant_id, name, credential_type, encrypted_value, iv, description, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, credential_type, description, metadata, is_active, last_rotated_at, created_at`,
      [req.tenantId, name.trim(), credential_type || 'api_key',
       encrypted, iv, description || null,
       JSON.stringify(metadata || {}), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A vault entry with this name already exists' });
    logger.error('[SECURITY] vault create', { error: err.message });
    res.status(500).json({ error: 'Failed to create vault entry' });
  }
});

router.put('/vault/:id', auditLog('vault.update'), async (req, res) => {
  try {
    const { secret_value, description, metadata, is_active } = req.body;
    const existing = await db.query(
      'SELECT * FROM credential_vault WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });

    let enc = existing.rows[0].encrypted_value;
    let iv  = existing.rows[0].iv;
    if (secret_value?.trim()) {
      const result = encryptSecret(secret_value);
      enc = result.encrypted; iv = result.iv;
    }

    const { rows } = await db.query(
      `UPDATE credential_vault SET
         encrypted_value = $1, iv = $2,
         description = COALESCE($3, description),
         metadata    = COALESCE($4::jsonb, metadata),
         is_active   = COALESCE($5, is_active),
         last_rotated_at = CASE WHEN $6 THEN NOW() ELSE last_rotated_at END,
         updated_at  = NOW()
       WHERE id=$7 AND tenant_id=$8
       RETURNING id, name, credential_type, description, metadata, is_active, last_rotated_at`,
      [enc, iv, description, metadata ? JSON.stringify(metadata) : null,
       is_active, !!secret_value?.trim(), req.params.id, req.tenantId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update vault entry' });
  }
});

router.delete('/vault/:id', auditLog('vault.delete'), async (req, res) => {
  try {
    await db.query(
      'DELETE FROM credential_vault WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vault entry' });
  }
});

// Internal: resolve vault secret by name (used by connectors/engine)
router.get('/vault/resolve/:name', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT encrypted_value, iv FROM credential_vault WHERE tenant_id=$1 AND name=$2 AND is_active=true',
      [req.tenantId, req.params.name]
    );
    if (!rows.length) return res.status(404).json({ error: 'Vault entry not found' });
    const secret = decryptSecret(rows[0].encrypted_value, rows[0].iv);
    res.json({ secret });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve vault secret' });
  }
});

// ── Debug: show active session settings for current tenant ──────────────────
router.get('/session-debug', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT session_idle_timeout_mins, session_max_lifetime_mins,
              jwt_access_token_ttl_mins, jwt_refresh_token_ttl_days,
              updated_at
         FROM security_settings WHERE tenant_id=$1`,
      [req.tenantId]
    );
    const settings = rows[0] || {};

    // Decode the current token to show iat and exp
    const token = req.headers.authorization?.split(' ')[1];
    const jwt = require('jsonwebtoken');
    let tokenInfo = {};
    if (token && !token.startsWith('nxk_')) {
      try {
        const decoded = jwt.decode(token);
        const now = Math.floor(Date.now() / 1000);
        tokenInfo = {
          issued_at:       new Date(decoded.iat * 1000).toISOString(),
          expires_at:      new Date(decoded.exp * 1000).toISOString(),
          age_minutes:     Math.round((now - decoded.iat) / 60 * 10) / 10,
          expires_in_mins: Math.round((decoded.exp - now) / 60 * 10) / 10,
        };
      } catch {}
    }

    res.json({
      active_settings: {
        session_idle_timeout_mins:  settings.session_idle_timeout_mins,
        session_max_lifetime_mins:  settings.session_max_lifetime_mins,
        jwt_access_token_ttl_mins:  settings.jwt_access_token_ttl_mins,
        jwt_refresh_token_ttl_days: settings.jwt_refresh_token_ttl_days,
        last_updated:               settings.updated_at,
      },
      current_token: tokenInfo,
      note: 'Settings cache refreshes every 60 seconds. Token TTL applies only to NEW tokens issued after login.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Test email endpoint ────────────────────────────────────────────────────────
router.post('/test-email', auditLog('security.email.test'), async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'to address required' });
    // Dynamic require to avoid circular dep at module load time
    const EmailService = require('../services/email/EmailService');
    await EmailService.sendGenericMail({
      to,
      subject: 'NexusIAM — Email Config Test',
      body: `<p>This is a test email from <strong>NexusIAM</strong>.</p>
             <p>Your email configuration is working correctly.</p>
             <p style="color:#64748b;font-size:12px">Sent at: ${new Date().toISOString()}</p>`,
      tenantId: req.tenantId,
    });
    res.json({ success: true, message: `Test email sent to ${to}` });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to send test email' });
  }
});

module.exports = router;
module.exports.decryptSecret = decryptSecret;
module.exports.encryptSecret = encryptSecret;
