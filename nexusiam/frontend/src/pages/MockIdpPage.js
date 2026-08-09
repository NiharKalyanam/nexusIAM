/**
 * Mock SAML IdP — Built-in test identity provider
 *
 * Route: /saml/mock-idp
 * Used when SAML is enabled but no real IdP is configured.
 * Lets you test the full SAML flow locally.
 *
 * Shows a simple login form, then POSTs a fake SAML assertion to the ACS URL.
 */
import React, { useState } from 'react';

// These match the seeded users in docker/postgres/init.sql
// The email must match users.email in the DB for the SAML login to find the existing user
// (otherwise a new user is auto-provisioned with source='saml')
const MOCK_USERS = [
  { email: 'admin@nexusiam.io', firstName: 'System', lastName: 'Admin',   role: 'Super Admin',  note: 'Seeded admin — full access' },
  { email: 'john@example.com',  firstName: 'John',   lastName: 'Doe',     role: 'Standard User', note: 'Auto-provisioned on first login' },
  { email: 'jane@example.com',  firstName: 'Jane',   lastName: 'Smith',   role: 'Manager',       note: 'Auto-provisioned on first login' },
  { email: 'test@example.com',  firstName: 'Test',   lastName: 'User',    role: 'Read-only',     note: 'Auto-provisioned on first login' },
];

const DEFAULT_ACS_URL = 'http://localhost:3001/api/v1/auth/saml/callback';

function getSafeAcsUrl(rawAcs) {
  if (!rawAcs) return DEFAULT_ACS_URL;

  try {
    const parsed = new URL(rawAcs);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (e) {
    // ignore invalid URL and fall back
  }

  return DEFAULT_ACS_URL;
}

function buildMockSamlResponse(user, acsUrl) {
  // Build a minimal SAML Response XML (not cryptographically signed — test only)
  const id        = '_mock_' + Math.random().toString(36).slice(2);
  const now       = new Date().toISOString();
  const notAfter  = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const xml = `<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                ID="${id}" Version="2.0" IssueInstant="${now}"
                Destination="${acsUrl}">
  <saml:Issuer>https://mock-idp.nexusiam.local</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  <saml:Assertion ID="${id}_a" Version="2.0" IssueInstant="${now}">
    <saml:Issuer>https://mock-idp.nexusiam.local</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${user.email}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="${notAfter}" Recipient="${acsUrl}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:AttributeStatement>
      <saml:Attribute Name="email">
        <saml:AttributeValue>${user.email}</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="firstName">
        <saml:AttributeValue>${user.firstName}</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="lastName">
        <saml:AttributeValue>${user.lastName}</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

  return btoa(xml); // base64 encode
}

export default function MockIdpPage() {
  const params  = new URLSearchParams(window.location.search);
  const acsUrl  = getSafeAcsUrl(params.get('acs'));
  const tenant  = params.get('tenant') || 'demo';

  const [selected, setSelected] = useState(MOCK_USERS[0].email);
  const [custom,   setCustom]   = useState({ email: '', firstName: '', lastName: '' });
  const [useCustom, setUseCustom] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = (e) => {
    e.preventDefault();
    setSubmitting(true);

    const user = useCustom
      ? custom
      : MOCK_USERS.find(u => u.email === selected);

    if (!user?.email) { setSubmitting(false); return; }

    const samlResponse = buildMockSamlResponse(user, acsUrl);

    // Auto-submit form to ACS URL
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = acsUrl;

    const resp = document.createElement('input');
    resp.type = 'hidden'; resp.name = 'SAMLResponse'; resp.value = samlResponse;
    form.appendChild(resp);

    const relay = document.createElement('input');
    relay.type = 'hidden'; relay.name = 'RelayState'; relay.value = tenant;
    form.appendChild(relay);

    document.body.appendChild(form);
    form.submit();
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid #1e2a3a', borderRadius: 12, padding: 32, width: '100%', maxWidth: 460 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🧪</div>
          <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Mock Identity Provider</div>
          <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>NexusIAM built-in test IdP — not for production use</div>
        </div>

        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: 10, marginBottom: 20, color: '#fbbf24' }}>
          ⚠ This is a simulated SAML IdP for testing. No real authentication is performed.
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}>Select test user:</div>
            {MOCK_USERS.map(u => (
              <label key={u.email} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 8, marginBottom: 6, cursor: 'pointer',
                background: selected === u.email && !useCustom ? 'rgba(56,189,248,0.08)' : 'var(--bg-primary)',
                border: `1px solid ${selected === u.email && !useCustom ? '#38bdf840' : 'var(--bg-tertiary)'}` }} onClick={() => { setSelected(u.email); setUseCustom(false); }}>
                <input type="radio" checked={selected === u.email && !useCustom}
                  onChange={() => { setSelected(u.email); setUseCustom(false); }}
                  style={{ accentColor: '#38bdf8' }} />
                <div>
                  <div style={{ color: 'var(--text-primary)', fontWeight:600 }}>{u.firstName} {u.lastName}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{u.email}</div>
                  <div style={{ color: 'var(--text-secondary)', marginTop:2 }}>{u.role} · {u.note}</div>
                </div>
              </label>
            ))}

            {/* Custom user option */}
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
              borderRadius: 8, marginBottom: 6, cursor: 'pointer',
              background: useCustom ? 'rgba(139,92,246,0.08)' : 'var(--bg-primary)',
              border: `1px solid ${useCustom ? '#8b5cf640' : 'var(--bg-tertiary)'}` }} onClick={() => setUseCustom(true)}>
              <input type="radio" checked={useCustom} onChange={() => setUseCustom(true)}
                style={{ accentColor: '#8b5cf6', marginTop: 3 }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--text-primary)', marginBottom: useCustom ? 8 : 0 }}>Custom user</div>
                {useCustom && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[['email','Email *'],['firstName','First Name'],['lastName','Last Name']].map(([k,l]) => (
                      <input key={k} style={{ padding: '6px 8px', background: 'var(--bg-tertiary)', border: '1px solid #2a3545', borderRadius: 6, color: 'var(--text-primary)' }}
                        placeholder={l} value={custom[k]}
                        onChange={e => setCustom(c => ({ ...c, [k]: e.target.value }))}
                        onClick={e => e.stopPropagation()} />
                    ))}
                  </div>
                )}
              </div>
            </label>
          </div>

          {/* ACS URL display */}
          <div style={{ background: 'var(--bg-primary)', borderRadius: 6, padding: '8px 12px', marginBottom: 16, color: 'var(--text-secondary)' }}>
            Sending assertion to: <span style={{ color: 'var(--text-muted)' }}>{acsUrl}</span>
          </div>

          <button type="submit" disabled={submitting} style={{
            width: '100%', padding: '10px 0', background: 'linear-gradient(135deg, #38bdf8, #0284c7)',
            border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Authenticating…' : 'Sign In via Mock IdP'}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <a href="/login" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
            ← Back to normal login
          </a>
        </div>
      </div>
    </div>
  );
}
