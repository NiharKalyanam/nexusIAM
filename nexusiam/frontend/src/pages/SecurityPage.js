import React, { useEffect, useState, useCallback } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { RefreshCw, Plus, Trash2, Eye, EyeOff, Copy, Key, Shield, Mail, Clock } from 'lucide-react';

const TABS = [
  { key: 'session',   label: 'Session & Tokens', icon: Clock  },
  { key: 'email',     label: 'Email Config',      icon: Mail   },
  { key: 'saml',      label: 'SAML / SSO',        icon: Shield },
  { key: 'apikeys',   label: 'API Keys',          icon: Key    },
  { key: 'vault',     label: 'Credential Vault',  icon: Shield },
  { key: 'password',  label: 'Password Policy',   icon: Key    },
];

const CRED_TYPES = ['api_key','basic','oauth2','token','certificate'];

function PasswordPolicyTab() {
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    API.get('/password-policy')
      .then(r => setPolicy(r.data))
      .catch(() => toast.error('Failed to load password policy'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await API.put('/password-policy', policy);
      toast.success('Password policy saved');
    } catch { toast.error('Failed to save password policy'); }
    finally { setSaving(false); }
  };

  const set = (k, v) => setPolicy(p => ({ ...p, [k]: v }));

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>;
  if (!policy) return null;

  const Section = ({ title, children }) => (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 18, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>{title}</div>
      {children}
    </div>
  );

  const Toggle = ({ label, desc, field }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
        {desc && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>}
      </div>
      <button
        onClick={() => set(field, !policy[field])}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: policy[field] ? 'var(--accent)' : 'var(--border-bright)',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: policy[field] ? 22 : 2,
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', display: 'block'
        }} />
      </button>
    </div>
  );

  const NumField = ({ label, field, min = 0, max = 999 }) => (
    <div className="form-group">
      <label>{label}</label>
      <input
        type="number" min={min} max={max}
        value={policy[field] ?? 0}
        onChange={e => set(field, parseInt(e.target.value) || 0)}
        style={{ maxWidth: 120 }}
      />
    </div>
  );

  return (
    <div>
      <Section title="🔒 Hashing Configuration">
        <Toggle label="Enable One-Way Hashing" desc="Passwords are hashed before storage using bcrypt" field="enable_hashing" />
        <div style={{ marginTop: 14 }}>
          <NumField label="Number of Hashing Iterations (bcrypt rounds)" field="hashing_iterations" min={1} max={20} />
        </div>
        <Toggle label="Require Current Password When Setting New Password" desc="Users must enter their existing password before changing" field="require_current_password" />
      </Section>

      <Section title="🔑 Password Character Requirements">
        <div className="form-row form-row-3">
          <NumField label="Minimum Characters" field="min_length" min={1} />
          <NumField label="Maximum Characters" field="max_length" min={1} />
          <NumField label="Minimum Letters" field="min_letters" min={0} />
        </div>
        <div className="form-row form-row-3">
          <NumField label="Minimum Digits" field="min_digits" min={0} />
          <NumField label="Minimum Uppercase Letters" field="min_uppercase" min={0} />
          <NumField label="Minimum Lowercase Letters" field="min_lowercase" min={0} />
        </div>
        <div className="form-row form-row-3">
          <NumField label="Minimum Special Characters" field="min_special" min={0} />
          <NumField label="Max Repeated Characters Allowed" field="max_repeated" min={0} />
          <NumField label="Password History Length" field="history_length" min={0} />
        </div>
      </Section>

      <Section title="📅 Expiration & Change Rules">
        <div className="form-row form-row-3">
          <NumField label="Days Until Expiry (Manual)" field="days_until_expiry" min={0} />
          <NumField label="Days Until Expiry (Generated)" field="days_until_generated_expiry" min={0} />
          <NumField label="Min Hours Between Changes" field="min_hours_between_changes" min={0} />
        </div>
      </Section>

      <Section title="✅ Validation Rules">
        <Toggle label="Case Sensitive Check" desc="Password comparison is case-sensitive" field="case_sensitive" />
        <Toggle label="Triviality Check Against Old Password" desc="New password cannot be similar to the previous one" field="trivial_check" />
        <Toggle label="Validate Against Password Dictionary" desc="Block commonly used weak passwords" field="check_dictionary" />
        <Toggle label="Validate Against Identity Attributes" desc="Password cannot contain the user's name, email, username, etc." field="check_identity_attrs" />
        <div style={{ marginTop: 14 }}>
          <NumField label="Minimum Attribute Length to Check Against" field="min_attr_length" min={1} />
        </div>
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : '💾 Save Password Policy'}
        </button>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const [tab, setTab]           = useState('session');
  const [settings, setSettings] = useState(null);
  const [apiKeys, setApiKeys]   = useState([]);
  const [vault, setVault]       = useState([]);
  const [saving, setSaving]     = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [samlInfo, setSamlInfo] = useState(null);

  // New API key modal
  const [newKeyModal, setNewKeyModal]   = useState(false);
  const [newKeyForm, setNewKeyForm]     = useState({ name: '', description: '', expires_at: '' });
  const [createdKey, setCreatedKey]     = useState(null); // shown once

  // Vault modal
  const [vaultModal, setVaultModal]     = useState(false);
  const [editingVault, setEditingVault] = useState(null);
  const [vaultForm, setVaultForm]       = useState({ name: '', credential_type: 'api_key', secret_value: '', description: '', metadata: '{}' });
  const [showSecret, setShowSecret]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, kRes, vRes, samlRes] = await Promise.allSettled([
        API.get('/security/settings'),
        API.get('/security/api-keys'),
        API.get('/security/vault'),
        API.get('/auth/saml/info'),
      ]);
      if (sRes.status === 'fulfilled') setSettings(sRes.value.data);
      if (kRes.status === 'fulfilled') setApiKeys(kRes.value.data || []);
      if (vRes.status === 'fulfilled') setVault(vRes.value.data || []);
      if (samlRes.status === 'fulfilled') setSamlInfo(samlRes.value.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const endpoint = tab === 'session' ? '/security/settings/session'
                     : tab === 'email'   ? '/security/settings/email'
                     : tab === 'saml'    ? '/security/settings/saml'
                     : '/security/settings/session';
      await API.put(endpoint, settings);
      toast.success('Settings saved');
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    setSaving(false);
  };

  const set = (field, value) => setSettings(s => ({ ...s, [field]: value }));

  const sendTestEmail = async () => {
    if (!testEmailTo.trim()) { toast.error('Enter a recipient email address'); return; }
    setTestSending(true);
    try {
      await API.post('/security/test-email', { to: testEmailTo });
      toast.success(`Test email sent to ${testEmailTo}`);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to send test email'); }
    setTestSending(false);
  };

  // ── API Keys ────────────────────────────────────────────────────────────────
  const createApiKey = async () => {
    if (!newKeyForm.name.trim()) { toast.error('Name required'); return; }
    try {
      const { data } = await API.post('/security/api-keys', newKeyForm);
      setCreatedKey(data);
      setNewKeyModal(false);
      setNewKeyForm({ name: '', description: '', expires_at: '' });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const toggleKey = async (id) => {
    try { await API.put(`/security/api-keys/${id}/toggle`); load(); }
    catch (e) { toast.error('Failed'); }
  };

  const deleteKey = async (id, name) => {
    if (!window.confirm(`Delete API key "${name}"? This cannot be undone.`)) return;
    try { await API.delete(`/security/api-keys/${id}`); toast.success('Deleted'); load(); }
    catch (e) { toast.error('Failed'); }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'));
  };

  // ── Vault ───────────────────────────────────────────────────────────────────
  const openVaultCreate = () => {
    setEditingVault(null);
    setVaultForm({ name: '', credential_type: 'api_key', secret_value: '', description: '', metadata: '{}' });
    setShowSecret(false);
    setVaultModal(true);
  };

  const openVaultEdit = (entry) => {
    setEditingVault(entry);
    setVaultForm({ name: entry.name, credential_type: entry.credential_type, secret_value: '', description: entry.description || '', metadata: JSON.stringify(entry.metadata || {}, null, 2) });
    setShowSecret(false);
    setVaultModal(true);
  };

  const saveVault = async () => {
    if (!vaultForm.name.trim()) { toast.error('Name required'); return; }
    if (!editingVault && !vaultForm.secret_value.trim()) { toast.error('Secret value required'); return; }
    try {
      let meta = {};
      try { meta = JSON.parse(vaultForm.metadata || '{}'); } catch { toast.error('Metadata must be valid JSON'); return; }
      if (editingVault) {
        await API.put(`/security/vault/${editingVault.id}`, { ...vaultForm, metadata: meta });
        toast.success('Vault entry updated');
      } else {
        await API.post('/security/vault', { ...vaultForm, metadata: meta });
        toast.success('Vault entry created');
      }
      setVaultModal(false);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const deleteVault = async (id, name) => {
    if (!window.confirm(`Delete vault entry "${name}"?`)) return;
    try { await API.delete(`/security/vault/${id}`); toast.success('Deleted'); load(); }
    catch (e) { toast.error('Failed'); }
  };

  // ── Shared styles ────────────────────────────────────────────────────────────
  const card = { background: 'var(--bg-card)', border: '1px solid #1e2a3a', borderRadius: 10, padding: 20, marginBottom: 16 };
  const sectionTitle = { color: '#38bdf8', fontWeight: 700, marginBottom: 14 };
  const label = { color: 'var(--text-muted)', marginBottom: 4, display: 'block' };
  const inputStyle = { width: '100%', padding: '8px 10px', background: 'var(--bg-primary)', border: '1px solid #1e2a3a', borderRadius: 6, color: 'var(--text-primary)' };

  const tabBtn = (t) => (
    <button key={t.key} onClick={() => setTab(t.key)} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 16px', background: tab === t.key ? 'rgba(56,189,248,0.1)' : 'none',
      border: 'none', borderBottom: `2px solid ${tab === t.key ? '#38bdf8' : 'transparent'}`,
      color: tab === t.key ? '#38bdf8' : 'var(--text-muted)',
      cursor: 'pointer', fontWeight: tab === t.key ? 600 : 400, whiteSpace: 'nowrap' }}>
      <t.icon size={14} />{t.label}
    </button>
  );

  if (loading || !settings) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading security settings…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Security</div>
          <div className="page-subtitle">SSO, session management, email, API keys, and credential vault</div>
        </div>
        <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /></button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e2a3a', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.map(tabBtn)}
      </div>

      {/* ── Session & Tokens ─────────────────────────────────────────────────── */}
      {tab === 'session' && (
        <div>
          <div style={card}>
            <div style={sectionTitle}>Session Timeouts</div>
            <div className="form-row form-row-2">
              <div className="form-group">
                <label style={label}>Idle Timeout (minutes)</label>
                <input style={inputStyle} type="number" min={5} max={480}
                  value={settings.session_idle_timeout_mins ?? 30}
                  onChange={e => set('session_idle_timeout_mins', parseInt(e.target.value))} />
                <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>User is logged out after this many minutes of inactivity</div>
              </div>
              <div className="form-group">
                <label style={label}>Max Session Lifetime (minutes)</label>
                <input style={inputStyle} type="number" min={30} max={10080}
                  value={settings.session_max_lifetime_mins ?? 480}
                  onChange={e => set('session_max_lifetime_mins', parseInt(e.target.value))} />
                <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Absolute maximum — user must re-authenticate after this time regardless of activity</div>
              </div>
            </div>
          </div>
          <div style={card}>
            <div style={sectionTitle}>JWT Token Lifetimes</div>
            <div className="form-row form-row-2">
              <div className="form-group">
                <label style={label}>Access Token TTL (minutes)</label>
                <input style={inputStyle} type="number" min={1} max={60}
                  value={settings.jwt_access_token_ttl_mins ?? 15}
                  onChange={e => set('jwt_access_token_ttl_mins', parseInt(e.target.value))} />
                <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Short-lived. Recommended: 15 min</div>
              </div>
              <div className="form-group">
                <label style={label}>Refresh Token TTL (days)</label>
                <input style={inputStyle} type="number" min={1} max={90}
                  value={settings.jwt_refresh_token_ttl_days ?? 7}
                  onChange={e => set('jwt_refresh_token_ttl_days', parseInt(e.target.value))} />
                <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Long-lived token used to get new access tokens</div>
              </div>
            </div>
          </div>
          <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
            {saving ? 'Saving…' : 'Save Session Settings'}
          </button>
        </div>
      )}

      {/* ── Email Config ─────────────────────────────────────────────────────── */}
      {tab === 'email' && (
        <div>
          <div style={card}>
            <div style={sectionTitle}>Email Transport</div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label style={label}>Delivery Method</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {[
                { id:'mailhog', label:'MailHog',  desc:'Default — local test catcher',    color:'#10b981' },
                { id:'smtp',    label:'SMTP',      desc:'Send via real SMTP server',        color:'#38bdf8' },
                { id:'file',    label:'File',      desc:'Write emails to disk as HTML',     color:'#8b5cf6' },
                { id:'disabled',label:'Disabled',  desc:'Suppress all emails',              color:'var(--text-muted)' },
              ].map(t => (
                <label key={t.id} style={{
                  display:'flex', alignItems:'center', gap:10, cursor:'pointer',
                  padding:'10px 14px', borderRadius:8, flex:1, minWidth:130,
                  border:`1px solid ${settings.email_transport===t.id ? t.color+'60' : 'var(--bg-tertiary)'}`,
                  background: settings.email_transport===t.id ? t.color+'12' : 'var(--bg-primary)' }}
                  onClick={() => set('email_transport', t.id)}>
                  <input type="radio" checked={settings.email_transport===t.id}
                    onChange={() => {}} style={{ accentColor: t.color }} />
                  <div>
                    <div style={{ color: settings.email_transport===t.id ? t.color : 'var(--border-bright)', fontWeight:700 }}>{t.label}</div>
                    <div style={{ color:'var(--text-secondary)', marginTop:2 }}>{t.desc}</div>
                  </div>
                </label>
              ))}              </div>
            </div>

            {settings.email_transport === 'mailhog' && (
              <div style={{ background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.2)', borderRadius:8, padding:14 }}>
                <div style={{ color:'#34d399', fontWeight:600, marginBottom:6 }}>✓ MailHog — Default Configuration</div>
                <div style={{ color:'var(--text-muted)', marginBottom:8 }}>All emails go to the local MailHog catcher. View them at <a href="http://localhost:8025" target="_blank" rel="noreferrer" style={{ color:'#38bdf8' }}>localhost:8025</a></div>
                <div style={{ display:'flex', gap:16 }}>
                  {[['Host','mailhog'],['Port','1025'],['Auth','None'],['TLS','Off']].map(([k,v]) => (
                    <div key={k}><span style={{ color:'var(--text-secondary)' }}>{k}: </span><code style={{ color:'var(--text-secondary)' }}>{v}</code></div>
                  ))}
                </div>
              </div>
            )}
            {settings.email_transport === 'smtp' && (
              <>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label style={label}>SMTP Host</label>
                    <input style={inputStyle} value={settings.email_smtp_host || ''}
                      onChange={e => set('email_smtp_host', e.target.value)} placeholder="smtp.example.com" />
                  </div>
                  <div className="form-group">
                    <label style={label}>SMTP Port</label>
                    <input style={inputStyle} type="number" value={settings.email_smtp_port || 587}
                      onChange={e => set('email_smtp_port', parseInt(e.target.value))} />
                  </div>
                </div>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label style={label}>Username</label>
                    <input style={inputStyle} value={settings.email_smtp_user || ''}
                      onChange={e => set('email_smtp_user', e.target.value)} placeholder="user@smtp.example.com" />
                  </div>
                  <div className="form-group">
                    <label style={label}>Password <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(leave blank to keep existing)</span></label>
                    <input style={inputStyle} type="password" value={settings.email_smtp_pass || ''}
                      onChange={e => set('email_smtp_pass', e.target.value)} placeholder="••••••••" />
                    <div style={{ color: 'var(--text-secondary)', marginTop: 3 }}>Stored encrypted in Credential Vault</div>
                  </div>
                </div>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label style={label}>From Address</label>
                    <input style={inputStyle} value={settings.email_smtp_from || ''}
                      onChange={e => set('email_smtp_from', e.target.value)}
                      placeholder="NexusIAM <noreply@nexusiam.io>" />
                  </div>
                  <div className="form-group" style={{ paddingTop: 22 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--border-bright)' }}>
                      <input type="checkbox" checked={!!settings.email_smtp_tls}
                        onChange={e => set('email_smtp_tls', e.target.checked)}
                        style={{ accentColor: '#10b981' }} />
                      Enable TLS / STARTTLS
                    </label>
                  </div>
                </div>
              </>
            )}

            {settings.email_transport === 'file' && (
              <div className="form-group">
                <label style={label}>Output Directory</label>
                <input style={inputStyle} value={settings.email_file_path || '/tmp/nexusiam-emails'}
                  onChange={e => set('email_file_path', e.target.value)} />
                <div style={{ color: 'var(--text-secondary)', marginTop: 3 }}>Each email saved as a .html file in this directory</div>
              </div>
            )}

            {settings.email_transport === 'disabled' && (
              <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: 12, color: '#fbbf24' }}>
                ⚠ All email notifications are disabled. No emails will be sent.
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
            {saving ? 'Saving…' : 'Save Email Config'}
          </button>
          <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid #1e2a3a' }}>
            <div style={{ color: '#38bdf8', fontWeight: 600, marginBottom: 10 }}>Send Test Email</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-card)', border: '1px solid #1e2a3a', borderRadius: 6, color: 'var(--text-primary)' }}
                type="email" placeholder="recipient@example.com" value={testEmailTo}
                onChange={e => setTestEmailTo(e.target.value)} />
              <button className="btn btn-secondary" onClick={sendTestEmail} disabled={testSending}>
                {testSending ? 'Sending…' : 'Send Test'}
              </button>
            </div>
            <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
              Sends a test email using the current saved config. Save first, then test.
            </div>
          </div>
        </div>
      )}

      {/* ── SAML / SSO ─────────────────────────────────────────────────────── */}
      {tab === 'saml' && (
        <div>
          {/* Mode selector */}
          <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
            {[
              { id:'mock',     icon:'🧪', label:'Mock IdP',     desc:'Built-in test — no config needed' },
              { id:'keycloak', icon:'🔑', label:'Keycloak',     desc:'Local Keycloak on port 8080' },
              { id:'external', icon:'🌐', label:'External IdP', desc:'Azure AD, Okta, ADFS, etc.' },
            ].map(m => {
              const active = samlInfo?.mode === m.id;
              return (
                <div key={m.id} style={{ flex:1, minWidth:160, padding:'12px 16px', borderRadius:10,
                  background: active ? 'rgba(56,189,248,0.08)' : 'var(--bg-card)',
                  border:`1px solid ${active ? '#38bdf8' : 'var(--bg-tertiary)'}`, cursor:'default' }}>
                  <div style={{ marginBottom:4 }}>{m.icon}</div>
                  <div style={{ color: active ? '#38bdf8' : 'var(--text-primary)', fontWeight:700 }}>{m.label}</div>
                  <div style={{ color:'var(--text-muted)', marginTop:2 }}>{m.desc}</div>
                  {active && <div style={{ marginTop:6, color:'#10b981', fontWeight:600 }}>← Currently active</div>}
                </div>
              );
            })}
          </div>

          {/* ── Mode 1: Mock — always visible, no config ──────────────────── */}
          <div style={card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={sectionTitle}>🧪 Mode 1 — Mock IdP (Test instantly)</div>
              {samlInfo && (
                <a href={`/saml/mock-idp?tenant=demo&acs=${encodeURIComponent(samlInfo.acsUrl||'')}`}
                   target="_blank" rel="noreferrer"
                   style={{ padding:'6px 14px', background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.3)', borderRadius:6, color:'#fbbf24', textDecoration:'none' }}>
                  Open Mock IdP →
                </a>
              )}
            </div>
            <div style={{ color:'var(--text-muted)' }}>
              No configuration needed. Click "Sign in with SSO / SAML" on the login page — it will use the mock IdP automatically when no real IdP is configured. Choose any test user to simulate a SAML login.
            </div>
          </div>

          {/* ── Mode 2: Keycloak ──────────────────────────────────────────── */}
          <div style={card}>
            <div style={sectionTitle}>🔑 Mode 2 — Keycloak (already running on port 8080)</div>
            <ol style={{ color:'var(--text-secondary)', paddingLeft:20, margin:0, lineHeight:1.8 }}>
              <li>Open <a href="http://localhost:8080" target="_blank" rel="noreferrer" style={{ color:'#38bdf8' }}>http://localhost:8080</a> → Admin Console (admin / admin)</li>
              <li>Clients → Create client → Client type: <strong style={{ color:'var(--text-primary)' }}>SAML</strong>, Client ID: <code style={{ color:'#a78bfa' }}>nexusiam-saml</code></li>
              <li>Set Valid Redirect URI and Master SAML Processing URL to:<br/>
                <code style={{ background:'var(--bg-primary)', padding:'2px 8px', borderRadius:4, color:'#34d399' }}>{samlInfo?.acsUrl || 'http://localhost:3001/api/v1/auth/saml/callback'}</code>
              </li>
              <li>Download the realm certificate from: Realm Settings → Keys → RS256 → Certificate</li>
              <li>Fill in the External IdP Config below with:<br/>
                IdP SSO URL: <code style={{ background:'var(--bg-primary)', padding:'2px 8px', borderRadius:4, color:'#34d399' }}>http://localhost:8080/realms/nexusiam/protocol/saml</code>
              </li>
            </ol>
          </div>

          {/* ── Mode 3: External IdP — always visible config form ─────────── */}
          <div style={card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div style={sectionTitle}>🌐 External IdP Configuration (Keycloak / Azure AD / Okta / ADFS)</div>
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                <input type="checkbox" checked={!!settings.saml_enabled}
                  onChange={e => set('saml_enabled', e.target.checked)}
                  style={{ accentColor:'#10b981', width:16, height:16 }} />
                <span style={{ color: settings.saml_enabled ? '#10b981' : 'var(--text-muted)', fontWeight:600 }}>
                  {settings.saml_enabled ? '✓ SAML Enabled' : 'Enable SAML'}
                </span>
              </label>
            </div>

            {/* SP details to give to IdP team */}
            {samlInfo && (
              <div style={{ background:'rgba(56,189,248,0.05)', border:'1px solid rgba(56,189,248,0.15)', borderRadius:8, padding:14, marginBottom:18 }}>
                <div style={{ color:'#38bdf8', fontWeight:600, marginBottom:10 }}>📋 Give these to your IdP / IT team:</div>
                {[
                  ['ACS URL (Reply URL)',  samlInfo.acsUrl],
                  ['SP Metadata URL',      samlInfo.metadataUrl],
                  ['SP Entity ID',         samlInfo.acsUrl?.replace('/callback','')],
                ].map(([lbl, val]) => (
                  <div key={lbl} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                    <span style={{ color:'var(--text-muted)', minWidth:130 }}>{lbl}</span>
                    <code style={{ flex:1, background:'var(--bg-primary)', padding:'4px 8px', borderRadius:4, color:'var(--text-secondary)', wordBreak:'break-all' }}>{val}</code>
                    <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(val||'').then(()=>toast.success('Copied'))}>Copy</button>
                  </div>
                ))}
              </div>
            )}

            <div className="form-row form-row-2">
              <div className="form-group">
                <label style={label}>SP Entity ID <span style={{ color:'var(--text-secondary)', fontWeight:400 }}>(your NexusIAM URL)</span></label>
                <input style={inputStyle} value={settings.saml_sp_entity_id || ''}
                  onChange={e => set('saml_sp_entity_id', e.target.value)}
                  placeholder="https://nexusiam.yourcompany.com" />
              </div>
              <div className="form-group">
                <label style={label}>IdP Entity ID</label>
                <input style={inputStyle} value={settings.saml_idp_entity_id || ''}
                  onChange={e => set('saml_idp_entity_id', e.target.value)}
                  placeholder="https://idp.yourcompany.com" />
              </div>
            </div>
            <div className="form-row form-row-2">
              <div className="form-group">
                <label style={label}>IdP SSO URL <span style={{ color:'#ef4444' }}>*</span></label>
                <input style={inputStyle} value={settings.saml_idp_sso_url || ''}
                  onChange={e => set('saml_idp_sso_url', e.target.value)}
                  placeholder="https://idp.yourcompany.com/saml2/sso" />
                <div style={{ color:'var(--text-secondary)', marginTop:3 }}>Keycloak: http://localhost:8080/realms/nexusiam/protocol/saml</div>
              </div>
              <div className="form-group">
                <label style={label}>IdP SLO URL <span style={{ color:'var(--text-secondary)', fontWeight:400 }}>(optional)</span></label>
                <input style={inputStyle} value={settings.saml_idp_slo_url || ''}
                  onChange={e => set('saml_idp_slo_url', e.target.value)}
                  placeholder="https://idp.yourcompany.com/saml2/slo" />
              </div>
            </div>
            <div className="form-group">
              <label style={label}>IdP X.509 Certificate <span style={{ color:'#ef4444' }}>*</span></label>
              <textarea style={{ ...inputStyle, fontFamily:'monospace', resize:'vertical' }}
                rows={5} value={settings.saml_idp_certificate || ''}
                onChange={e => set('saml_idp_certificate', e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----&#10;MIICxxx...&#10;-----END CERTIFICATE-----" />
            </div>
            <div style={{ ...card, background:'var(--bg-primary)', marginTop:8, marginBottom:0 }}>
              <div style={{ color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>Attribute Mapping <span style={{ color:'var(--text-secondary)', textTransform:'none', letterSpacing:0 }}>(map IdP assertion attributes → NexusIAM fields)</span></div>
              {['email','firstName','lastName','employeeId','department'].map(field => (
                <div key={field} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
                  <div style={{ color:'#a78bfa', fontFamily:'monospace', minWidth:110 }}>{field}</div>
                  <span style={{ color:'var(--text-secondary)' }}>←</span>
                  <input style={{ ...inputStyle, flex:1 }}
                    value={(settings.saml_attribute_map||{})[field] || field}
                    onChange={e => set('saml_attribute_map', { ...(settings.saml_attribute_map||{}), [field]: e.target.value })}
                    placeholder={`IdP attribute for ${field}`} />
                </div>
              ))}
            </div>
          </div>

          <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
            {saving ? 'Saving…' : 'Save SAML Settings'}
          </button>
        </div>
      )}

      {/* ── API Keys ─────────────────────────────────────────────────────────── */}
      {tab === 'apikeys' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ color: 'var(--text-secondary)' }}>{apiKeys.length} key{apiKeys.length !== 1 ? 's' : ''} · External systems use these to call NexusIAM APIs</div>
            <button className="btn btn-primary" onClick={() => setNewKeyModal(true)}><Plus size={14} /> New API Key</button>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Key ID</th><th>Preview</th><th>Status</th><th>Last Used</th><th>Expires</th><th>Created By</th><th></th></tr>
              </thead>
              <tbody>
                {apiKeys.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No API keys yet.</td></tr>}
                {apiKeys.map(k => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{k.name}</td>
                    <td><code style={{ color: 'var(--text-secondary)' }}>{k.key_id}</code></td>
                    <td><code style={{ color: 'var(--text-muted)' }}>…{k.key_preview}</code></td>
                    <td>
                      <span style={{ background: k.is_active ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.12)',
                        color: k.is_active ? '#34d399' : 'var(--text-muted)', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
                        {k.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'No expiry'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{k.created_by_name || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => toggleKey(k.id)}>
                          {k.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteKey(k.id, k.name)}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ ...card, marginTop: 16, background: 'var(--bg-primary)' }}>
            <div style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>How to use API keys</div>
            <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}>Include the full key in the Authorization header:</div>
            <code style={{ display: 'block', background: 'var(--bg-primary)', padding: '10px 14px', borderRadius: 6, color: '#a78bfa' }}>
              Authorization: Bearer nxk_&lt;key_id&gt;:&lt;secret&gt;{'\n'}
              X-Tenant-ID: your-tenant-id
            </code>
          </div>
        </div>
      )}

      {/* ── Credential Vault ─────────────────────────────────────────────────── */}
      {tab === 'vault' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ color: 'var(--text-secondary)' }}>{vault.length} entr{vault.length !== 1 ? 'ies' : 'y'} · Encrypted secrets for NexusIAM to call external systems</div>
            <button className="btn btn-primary" onClick={openVaultCreate}><Plus size={14} /> New Secret</button>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Type</th><th>Description</th><th>Status</th><th>Last Rotated</th><th>Created By</th><th></th></tr>
              </thead>
              <tbody>
                {vault.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No vault entries yet.</td></tr>}
                {vault.map(v => (
                  <tr key={v.id}>
                    <td><code style={{ color: '#a78bfa' }}>{v.name}</code></td>
                    <td><span style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399', borderRadius: 4, padding: '2px 6px' }}>{v.credential_type}</span></td>
                    <td style={{ color: 'var(--text-muted)' }}>{v.description || '—'}</td>
                    <td><span style={{ background: v.is_active ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.12)',
                      color: v.is_active ? '#34d399' : 'var(--text-muted)', borderRadius: 4, padding: '2px 8px' }}>
                      {v.is_active ? 'Active' : 'Inactive'}
                    </span></td>
                    <td style={{ color: 'var(--text-muted)' }}>{v.last_rotated_at ? new Date(v.last_rotated_at).toLocaleDateString() : '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{v.created_by_name || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openVaultEdit(v)}>Rotate / Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteVault(v.id, v.name)}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── New API Key Modal ─────────────────────────────────────────────────── */}
      {newKeyModal && (
        <div className="modal-overlay" onClick={() => setNewKeyModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Create API Key</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setNewKeyModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group"><label>Name *</label>
                <input className="form-control" value={newKeyForm.name}
                  onChange={e => setNewKeyForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. ABC Team Integration" autoFocus />
              </div>
              <div className="form-group"><label>Description</label>
                <textarea className="form-control" rows={2} value={newKeyForm.description}
                  onChange={e => setNewKeyForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What system uses this key?" />
              </div>
              <div className="form-group"><label>Expiry Date <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input className="form-control" type="date" value={newKeyForm.expires_at}
                  onChange={e => setNewKeyForm(f => ({ ...f, expires_at: e.target.value }))} />
              </div>
              <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: 12, color: '#fbbf24' }}>
                ⚠ The full secret will be shown <strong>once</strong> after creation. Copy it immediately — it cannot be retrieved again.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setNewKeyModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createApiKey}>Create Key</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Created Key — Show Once Modal ────────────────────────────────────── */}
      {createdKey && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: '#10b981' }}>✓ API Key Created — Copy Now</span>
            </div>
            <div className="modal-body">
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: 6 }}>This is the only time you will see the full secret.</div>
                <div style={{ color: 'var(--text-secondary)' }}>After closing this dialog the secret cannot be retrieved. Store it securely now.</div>
              </div>
              <div className="form-group">
                <label style={{ color: 'var(--text-muted)' }}>Key ID (public)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <code style={{ flex: 1, background: 'var(--bg-primary)', padding: '8px 12px', borderRadius: 6, color: '#a78bfa', wordBreak: 'break-all' }}>{createdKey.key_id}</code>
                  <button className="btn btn-secondary btn-sm" onClick={() => copyToClipboard(createdKey.key_id)}><Copy size={12} /></button>
                </div>
              </div>
              <div className="form-group">
                <label style={{ color: 'var(--text-muted)' }}>Full API Key (use in Authorization header)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <code style={{ flex: 1, background: 'var(--bg-primary)', padding: '8px 12px', borderRadius: 6, color: '#34d399', wordBreak: 'break-all' }}>{createdKey.full_key}</code>
                  <button className="btn btn-secondary btn-sm" onClick={() => copyToClipboard(createdKey.full_key)}><Copy size={12} /></button>
                </div>
              </div>
              <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: 12 }}>
                <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>Usage example:</div>
                <code style={{ color: 'var(--text-secondary)' }}>Authorization: Bearer {createdKey.full_key}</code>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => { copyToClipboard(createdKey.full_key); setCreatedKey(null); }}>
                <Copy size={14} /> Copy & Close
              </button>
              <button className="btn btn-secondary" onClick={() => setCreatedKey(null)}>Close Without Copying</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Password Policy Tab ──────────────────────────────────────────────── */}
      {tab === 'password' && <PasswordPolicyTab />}

      {/* ── Vault Create/Edit Modal ───────────────────────────────────────────── */}
      {vaultModal && (
        <div className="modal-overlay" onClick={() => setVaultModal(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{editingVault ? 'Update Vault Entry' : 'New Vault Entry'}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setVaultModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group"><label>Name * <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(referenced in connectors/rules)</span></label>
                <input className="form-control mono" value={vaultForm.name}
                  onChange={e => setVaultForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="SAP_HR_API_KEY" disabled={!!editingVault} />
              </div>
              <div className="form-group"><label>Type</label>
                <select className="form-control" value={vaultForm.credential_type}
                  onChange={e => setVaultForm(f => ({ ...f, credential_type: e.target.value }))}>
                  {CRED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>{editingVault ? 'New Secret Value' : 'Secret Value *'} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{editingVault ? '(leave blank to keep existing)' : '(encrypted at rest)'}</span></label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="form-control" type={showSecret ? 'text' : 'password'}
                    style={{ flex: 1, fontFamily: 'monospace' }}
                    value={vaultForm.secret_value}
                    onChange={e => setVaultForm(f => ({ ...f, secret_value: e.target.value }))}
                    placeholder={editingVault ? '••••••••' : 'The actual secret/password/token'} />
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowSecret(s => !s)}>
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="form-group"><label>Description</label>
                <input className="form-control" value={vaultForm.description}
                  onChange={e => setVaultForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What system uses this credential?" />
              </div>
              <div className="form-group">
                <label>Metadata <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(non-secret info — JSON)</span></label>
                <textarea className="form-control mono" rows={3} value={vaultForm.metadata}
                  onChange={e => setVaultForm(f => ({ ...f, metadata: e.target.value }))}
                  placeholder='{"endpoint": "https://api.example.com", "username": "svc_account"}' />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setVaultModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveVault}>{editingVault ? 'Update' : 'Store Secret'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
