import React, { useState, useEffect } from 'react';
import { Save, RefreshCw, CheckSquare, Bell, Clock, Users, Shield } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

export default function AccessRequestSetupPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    API.get('/access-request-settings')
      .then(r => setSettings(r.data))
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  const [users, setUsers]           = useState([]);
  const [workgroups, setWorkgroups] = useState([]);

  useEffect(() => {
    API.get('/users?limit=200').then(r => setUsers(r.data?.data||[])).catch(()=>{});
    API.get('/workgroups').then(r => setWorkgroups(r.data?.data||r.data||[])).catch(()=>{});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await API.put('/access-request-settings', settings);
      toast.success('Access request settings saved');
    } catch { toast.error('Failed to save settings'); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>;
  if (!settings) return null;

  const Toggle = ({ label, desc, field, disabled }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, paddingRight: 20 }}>
        <div style={{ fontWeight: 500, color: disabled ? 'var(--text-muted)' : 'var(--text-primary)' }}>{label}</div>
        {desc && <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>{desc}</div>}
      </div>
      <button
        onClick={() => !disabled && set(field, !settings[field])}
        disabled={disabled}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: settings[field] ? 'var(--accent)' : 'var(--border-bright)',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
          opacity: disabled ? 0.5 : 1
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: settings[field] ? 22 : 2,
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', display: 'block'
        }} />
      </button>
    </div>
  );

  const NumField = ({ label, desc, field, min = 1 }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
        {desc && <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>{desc}</div>}
      </div>
      <input
        type="number" min={min} value={settings[field] ?? min}
        onChange={e => set(field, parseInt(e.target.value) || min)}
        style={{ width: 80, textAlign: 'center' }}
      />
    </div>
  );

  const Section = ({ icon: Icon, title, color, children }) => (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={color} />
        </div>
        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Dev email notice */}
      <div style={{ marginBottom:16, padding:'12px 16px', background:'rgba(6,182,212,0.08)', border:'1px solid rgba(6,182,212,0.25)', borderRadius:10, color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ }}>📧</span>
        <span>All system emails are captured by <strong>MailHog</strong> in development. View them at <a href="http://localhost:8025" target="_blank" rel="noreferrer" style={{ color:'var(--accent)' }}>http://localhost:8025</a></span>
      </div>
      <div className="page-header">
        <div>
          <div className="page-title">Access Request Setup</div>
          <div className="page-subtitle">Configure approval workflows, notifications, and escalation rules for access requests</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}><RefreshCw size={14} /></button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      <Section icon={Users} title="Approval Configuration" color="#06b6d4">
        <Toggle
          label="Manager Approval Required"
          desc="All access requests must be approved by the requester's manager. This is always enabled and cannot be disabled."
          field="require_manager_approval"
          disabled={true}
        />
        <Toggle
          label="Entitlement Owner Approval Required"
          desc="Requests for specific entitlements also require approval from the entitlement owner"
          field="require_entitlement_owner_approval"
        />
        <Toggle
          label="Allow Self-Approval"
          desc="Managers can approve their own access requests (not recommended)"
          field="allow_self_approval"
        />
      </Section>

      <Section icon={Clock} title="Timing & Expiration" color="#8b5cf6">
        <NumField
          label="Maximum Request Duration (Days)"
          desc="Maximum number of days an access request can be valid for"
          field="max_request_duration_days"
          min={1}
        />
        <NumField
          label="Reminder Frequency (Days)"
          desc="Send reminder notifications to approvers every N days"
          field="reminder_days"
          min={1}
        />
        <NumField
          label="Escalation After (Days)"
          desc="Escalate to next level approver if not actioned within N days"
          field="escalation_days"
          min={1}
        />
        <NumField
          label="Auto-Expire Pending Requests (Days)"
          desc="Automatically expire requests that haven't been approved or rejected"
          field="auto_expire_days"
          min={1}
        />
      </Section>

      <Section icon={Bell} title="Notification Configuration" color="#f59e0b">
        <Toggle
          label="Notify Requester"
          desc="Send email to the person who submitted the request on status changes"
          field="notify_requester"
        />
        <Toggle
          label="Notify Manager / Approver"
          desc="Send email to the assigned approver when a new request is pending"
          field="notify_manager"
        />
        <Toggle
          label="Notify Entitlement Owner"
          desc="Send email to the resource owner when their entitlement is requested"
          field="notify_owner"
        />
      </Section>

      <Section icon={Shield} title="Fallback Approver" color="#ef4444">
        <div style={{ marginBottom:14 }}>
          <div style={{ fontWeight:500, color:'var(--text-primary)', marginBottom:4 }}>Fallback Approver Type</div>
          <div style={{ display:'flex', gap:8, marginBottom:10 }}>
            {['user','workgroup'].map(t=>(
              <button key={t} onClick={()=>set('fallback_approver_type',t)}
                style={{ padding:'6px 14px', borderRadius:8, cursor:'pointer', fontWeight:500,
                  border:`2px solid ${settings.fallback_approver_type===t?'var(--accent)':'var(--border-bright)'}`,
                  background: settings.fallback_approver_type===t?'rgba(6,182,212,0.1)':'var(--bg-tertiary)',
                  color: settings.fallback_approver_type===t?'var(--accent)':'var(--text-secondary)' }}>
                {t.charAt(0).toUpperCase()+t.slice(1)}
              </button>
            ))}
          </div>
          <select value={settings.fallback_approver_id||''} onChange={e=>set('fallback_approver_id',e.target.value||null)}>
            <option value="">-- No Fallback (use Super Admin) --</option>
            {settings.fallback_approver_type==='workgroup'
              ? workgroups.map(w=><option key={w.id} value={w.id}>{w.name}</option>)
              : users.map(u=><option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.username})</option>)
            }
          </select>
          <div style={{ color:'var(--text-muted)', marginTop:6 }}>
            Used when target user has no manager. If workgroup is empty, falls back to Super Admin.
          </div>
        </div>
      </Section>

      <Section icon={Shield} title="How Approval Works" color="#10b981">
        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <p style={{ marginBottom: 10 }}>
            <strong style={{ color: 'var(--text-primary)' }}>Default Flow:</strong> Requester submits → Manager receives notification → Manager approves/rejects → Requester notified → Access provisioned automatically.
          </p>
          <p style={{ marginBottom: 10 }}>
            <strong style={{ color: 'var(--text-primary)' }}>With Entitlement Owner:</strong> Requester submits → Manager approves → Entitlement owner approves → Access provisioned.
          </p>
          <p style={{ marginBottom: 10 }}>
            <strong style={{ color: 'var(--text-primary)' }}>Escalation:</strong> If approver doesn't act within {settings.escalation_days} days, the request escalates to the next level manager.
          </p>
          <p>
            <strong style={{ color: 'var(--text-primary)' }}>Auto-Expiry:</strong> Requests not actioned within {settings.auto_expire_days} days are automatically expired and the requester is notified.
          </p>
        </div>
      </Section>
    </div>
  );
}
