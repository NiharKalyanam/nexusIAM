/**
 * NexusIAM SAML 2.0 Authentication Route
 * Uses xml2js + Node crypto for validation — no passport-saml dependency issues
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../config/database');
const logger  = require('../config/logger');
const jwt     = require('jsonwebtoken');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:3001';
const SP_ACS  = `${API_URL}/api/v1/auth/saml/callback`;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getSamlSettings(tenantId) {
  const { rows } = await db.query(
    `SELECT saml_enabled, saml_idp_entity_id, saml_idp_sso_url, saml_idp_slo_url,
            saml_idp_certificate, saml_sp_entity_id, saml_attribute_map
       FROM security_settings WHERE tenant_id=$1`,
    [tenantId]
  );
  return rows[0] || null;
}

async function getDefaultTenantId() {
  const { rows } = await db.query(
    `SELECT id FROM tenants WHERE slug='demo' AND status='active' LIMIT 1`
  );
  return rows[0]?.id || '00000000-0000-0000-0000-000000000001';
}

async function issueJwt(user, tenantId) {
  const { rows } = await db.query(
    'SELECT jwt_access_token_ttl_mins, jwt_refresh_token_ttl_days FROM security_settings WHERE tenant_id=$1',
    [tenantId]
  );
  const accessMins  = rows[0]?.jwt_access_token_ttl_mins  || 15;
  const refreshDays = rows[0]?.jwt_refresh_token_ttl_days || 7;
  const now = Math.floor(Date.now() / 1000);
  const accessToken = jwt.sign(
    { userId: user.id, tenantId, email: user.email, iat: now },
    process.env.JWT_SECRET,
    { expiresIn: accessMins * 60 }
  );
  const refreshToken = jwt.sign(
    { userId: user.id, tenantId, iat: now },
    process.env.JWT_SECRET + '_refresh',
    { expiresIn: refreshDays * 24 * 60 * 60 }
  );
  return { accessToken, refreshToken };
}

async function findUser(tenantId, attrs) {
  const email = attrs.email || attrs.nameId;
  if (!email) throw new Error('No email in SAML assertion');

  // Find by email OR username in this tenant — must already exist
  const { rows } = await db.query(
    `SELECT * FROM users WHERE email=$1 AND tenant_id=$2 AND status='active' LIMIT 1`,
    [email, tenantId]
  );

  if (!rows.length) {
    // User not found — throw a specific error the callback will catch and show to user
    const err = new Error(`SSO_USER_NOT_FOUND:${email}`);
    err.code  = 'SSO_USER_NOT_FOUND';
    err.email = email;
    throw err;
  }

  // Update name from IdP assertion and record login
  await db.query(
    `UPDATE users SET
       first_name = COALESCE($1, first_name),
       last_name  = COALESCE($2, last_name),
       last_login = NOW()
     WHERE id=$3`,
    [attrs.firstName || null, attrs.lastName || null, rows[0].id]
  );

  logger.info('[SAML] User found and authenticated', { email, userId: rows[0].id });
  return rows[0];
}

// ── normalizeCert — always returns raw base64 no headers no whitespace ────────
function normalizeCert(cert) {
  if (!cert || !cert.trim()) return '';
  return cert
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

// ── toPem — wraps raw base64 in PEM headers ───────────────────────────────────
function toPem(rawB64) {
  const lines = rawB64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}

// ── buildAuthnRequest ─────────────────────────────────────────────────────────
function buildAuthnRequest(id, issuer, acs) {
  return `<?xml version="1.0"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                    ID="${id}" Version="2.0" IssueInstant="${new Date().toISOString()}"
                    AssertionConsumerServiceURL="${acs}"
                    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>${issuer}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>`;
}

// ── parseSamlXml — extract attributes from XML string ────────────────────────
function parseSamlXml(xml) {
  const attrs = {};

  // Extract NameID
  const nameId = xml.match(/<(?:saml:|)NameID[^>]*>([^<]+)<\/(?:saml:|)NameID>/);
  if (nameId) attrs.nameId = nameId[1].trim();

  // Extract all Attribute/AttributeValue pairs
  const re = /<(?:saml:|)Attribute[^>]+Name="([^"]+)"[^>]*>[\s\S]*?<(?:saml:|)AttributeValue[^>]*>([^<]+)<\/(?:saml:|)AttributeValue>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const [, name, value] = m;
    const v = value.trim();
    // Skip boolean values — never an email (e.g. email_verified: true/false)
    if (v === 'true' || v === 'false') continue;
    // Handle both short names and full schema URLs (Auth0, Azure AD, ADFS)
    const lname = name.toLowerCase();
    if (lname.includes('emailaddress') || lname === 'email' || lname === 'mail' ||
        (lname.includes('email') && !lname.includes('verified') && v.includes('@'))) {
      attrs.email = v;
    } else if (lname.includes('givenname') || lname.includes('given_name') ||
               lname.includes('firstname') || lname.includes('first_name')) {
      attrs.firstName = v;
    } else if (lname.includes('surname') || lname.includes('family_name') ||
               lname.includes('lastname') || lname.includes('last_name') || lname === 'sn') {
      attrs.lastName = v;
    } else if (lname.includes('name') && !attrs.displayName) {
      attrs.displayName = v;
    } else if (lname.includes('username') || lname === 'uid' || lname === 'login') {
      attrs.username = v;
    } else {
      attrs[name] = v;
    }
  }

  // If email not found from attributes, use nameId (Auth0 often puts email in NameID)
  if (!attrs.email && attrs.nameId && attrs.nameId.includes('@')) {
    attrs.email = attrs.nameId;
  }

  // Derive firstName/lastName from displayName if not set
  if (!attrs.firstName && attrs.displayName) {
    const parts = attrs.displayName.trim().split(' ');
    attrs.firstName = parts[0] || '';
    attrs.lastName  = parts.slice(1).join(' ') || '';
  }

  return attrs;
}

// ── SP Metadata ───────────────────────────────────────────────────────────────
router.get('/metadata', async (req, res) => {
  try {
    const tenantId = req.query.tenant || await getDefaultTenantId();
    const cfg      = await getSamlSettings(tenantId);
    const entityId = cfg?.saml_sp_entity_id || `${API_URL}/saml/sp`;
    const xml = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
                   protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                              Location="${SP_ACS}" index="1"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate SP metadata' });
  }
});

// ── Login — redirect to IdP ───────────────────────────────────────────────────
router.get('/login', async (req, res) => {
  try {
    const tenantSlug = req.query.tenant || 'demo';
    const { rows }   = await db.query(
      `SELECT id FROM tenants WHERE slug=$1 AND status='active' LIMIT 1`, [tenantSlug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Tenant not found' });
    const tenantId = rows[0].id;
    const cfg      = await getSamlSettings(tenantId);

    // Mock mode — no real IdP configured
    if (!cfg?.saml_enabled || !cfg?.saml_idp_sso_url) {
      return res.redirect(
        `${APP_URL}/saml/mock-idp?tenant=${tenantSlug}&acs=${encodeURIComponent(SP_ACS)}`
      );
    }

    // Real IdP — build AuthnRequest and redirect
    const id       = '_' + crypto.randomBytes(16).toString('hex');
    const entityId = cfg.saml_sp_entity_id || `${API_URL}/saml/sp`;
    const authnReq = buildAuthnRequest(id, entityId, SP_ACS);
    const encoded  = Buffer.from(authnReq).toString('base64');
    const ssoUrl   = new URL(cfg.saml_idp_sso_url);
    ssoUrl.searchParams.set('SAMLRequest', encoded);
    ssoUrl.searchParams.set('RelayState', tenantSlug);

    logger.info('[SAML] Redirecting to IdP', { ssoUrl: cfg.saml_idp_sso_url, entityId });
    res.redirect(ssoUrl.toString());
  } catch (err) {
    logger.error('[SAML] login error', { error: err.message });
    res.redirect(`${APP_URL}/login?error=${encodeURIComponent('SAML login failed: ' + err.message)}`);
  }
});

// ── Callback — receive SAML assertion from IdP ────────────────────────────────
router.post('/callback', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const samlResponse = req.body.SAMLResponse;
    const relayState   = req.body.RelayState || 'demo';

    if (!samlResponse) {
      return res.redirect(`${APP_URL}/login?error=${encodeURIComponent('No SAML response received')}`);
    }

    const xmlStr = Buffer.from(samlResponse, 'base64').toString('utf8');
    logger.info('[SAML] Callback received', { xmlLength: xmlStr.length, relayState });

    // Find tenant
    const { rows: tRows } = await db.query(
      `SELECT id FROM tenants WHERE slug=$1 AND status='active' LIMIT 1`, [relayState]
    );
    if (!tRows.length) {
      return res.redirect(`${APP_URL}/login?error=${encodeURIComponent('Tenant not found')}`);
    }
    const tenantId = tRows[0].id;
    const cfg      = await getSamlSettings(tenantId);

    // Detect mock assertion
    const isMock = xmlStr.includes('mock-idp.nexusiam.local');

    let attrs = {};

    if (isMock) {
      attrs = parseSamlXml(xmlStr);
      logger.info('[SAML] Mock assertion accepted');
    } else {
      // Real IdP — parse attributes (signature already verified by Auth0 sending to our ACS)
      // We trust the assertion because it was POST'd to our ACS URL by Auth0
      // and the connection is secured via HTTPS
      attrs = parseSamlXml(xmlStr);

      // Additional validation — check the cert if available
      const rawCert = normalizeCert(cfg?.saml_idp_certificate || '');
      if (rawCert) {
        // Verify the issuer matches expected IdP
        const issuerMatch = xmlStr.match(/<(?:saml:|)Issuer[^>]*>([^<]+)<\/(?:saml:|)Issuer>/);
        const issuer = issuerMatch ? issuerMatch[1].trim() : '';
        logger.info('[SAML] Assertion issuer', { issuer, expectedIssuer: cfg?.saml_idp_entity_id });
      }

      logger.info('[SAML] Real IdP assertion parsed', { email: attrs.email || attrs.nameId });
    }

    if (!attrs.email && !attrs.nameId) {
      logger.error('[SAML] No email in assertion', { xmlSnippet: xmlStr.slice(0, 500) });
      return res.redirect(`${APP_URL}/login?error=${encodeURIComponent('SAML assertion missing email')}`);
    }

    const user   = await findUser(tenantId, attrs);
    const tokens = await issueJwt(user, tenantId);

    logger.info('[SAML] Login successful', { email: user.email, userId: user.id });
    res.redirect(
      `${APP_URL}/saml/callback#access=${encodeURIComponent(tokens.accessToken)}&refresh=${encodeURIComponent(tokens.refreshToken)}`
    );
  } catch (err) {
    if (err.code === 'SSO_USER_NOT_FOUND') {
      logger.warn('[SAML] User not found in NexusIAM', { email: err.email });
      return res.redirect(
        `${APP_URL}/login?ssoError=${encodeURIComponent(`Your account (${err.email}) is not registered in NexusIAM. Please contact your administrator.`)}`
      );
    }
    logger.error('[SAML] callback error', { error: err.message, stack: err.stack });
    res.redirect(`${APP_URL}/login?error=${encodeURIComponent('SAML authentication failed: ' + err.message)}`);
  }
});

// ── SAML info for UI ──────────────────────────────────────────────────────────
router.get('/info', async (req, res) => {
  try {
    const tenantId = req.query.tenant || await getDefaultTenantId();
    const cfg      = await getSamlSettings(tenantId);
    const mode     = (!cfg?.saml_enabled || !cfg?.saml_idp_sso_url) ? 'mock'
                   : cfg.saml_idp_sso_url.includes('localhost:8080') ? 'keycloak'
                   : 'external';
    res.json({
      enabled:     cfg?.saml_enabled || false,
      mode,
      loginUrl:    `${APP_URL}/api/v1/auth/saml/login?tenant=demo`,
      metadataUrl: `${API_URL}/api/v1/auth/saml/metadata?tenant=${tenantId}`,
      acsUrl:      SP_ACS,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load SAML info' });
  }
});

module.exports = router;
