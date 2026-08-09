import React, { useState, useEffect, useCallback } from 'react';
import Pagination from '../components/Pagination';
import { Plus, Search, RefreshCw, Edit, Trash2, UserX, Download } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

const statusColor = { active: 'success', inactive: 'gray', locked: 'danger', pending: 'warning' };

function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ username:'', email:'', first_name:'', last_name:'', department:'', title:'', password:'' });
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(f => ({...f, [k]: v}));
  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try { await API.post('/users', form); toast.success('User created'); onCreated(); onClose(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed to create user'); }
    finally { setLoading(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Create User</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row form-row-2">
              <div className="form-group"><label>First Name *</label><input value={form.first_name} onChange={e=>set('first_name',e.target.value)} required /></div>
              <div className="form-group"><label>Last Name</label><input value={form.last_name} onChange={e=>set('last_name',e.target.value)} /></div>
            </div>
            <div className="form-row form-row-2">
              <div className="form-group"><label>Username *</label><input value={form.username} onChange={e=>set('username',e.target.value)} required /></div>
              <div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={e=>set('email',e.target.value)} required /></div>
            </div>
            <div className="form-row form-row-2">
              <div className="form-group"><label>Department</label><input value={form.department} onChange={e=>set('department',e.target.value)} /></div>
              <div className="form-group"><label>Job Title</label><input value={form.title} onChange={e=>set('title',e.target.value)} /></div>
            </div>
            <div className="form-group"><label>Temp Password</label><input type="password" value={form.password} onChange={e=>set('password',e.target.value)} placeholder="Auto-generated if blank" /></div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create User'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Single-user action modal: Deactivate or Delete
function UserActionModal({ user, onClose, onDone }) {
  const [action, setAction] = useState('deactivate'); // 'deactivate' | 'delete'
  const [justification, setJustification] = useState('');
  const [loading, setLoading] = useState(false);

  const isDelete = action === 'delete';

  const handleSubmit = async () => {
    if (!justification.trim()) { toast.error('Business justification is required'); return; }
    setLoading(true);
    try {
      const url = isDelete ? `/users/${user.id}?hard=true` : `/users/${user.id}`;
      await API.delete(url, { data: { justification: justification.trim() } });
      toast.success(isDelete ? `${user.first_name} ${user.last_name} permanently deleted` : `${user.first_name} ${user.last_name} deactivated`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
            {isDelete ? <Trash2 size={16} /> : <UserX size={16} />}
            {isDelete ? 'Delete User' : 'Deactivate User'}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* User Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 14px', background: 'var(--bg-primary)', border: '1px solid #1e293b', borderRadius: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {user.first_name?.[0]}{user.last_name?.[0]}
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.first_name} {user.last_name}</div>
              <div style={{ color: 'var(--text-muted)' }}>{user.email} · {user.department || 'No department'}</div>
            </div>
          </div>

          {/* Action Toggle */}
          <div className="form-group">
            <label>Action</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={'btn btn-sm ' + (action === 'deactivate' ? 'btn-warning' : 'btn-secondary')}
                onClick={() => setAction('deactivate')}
                style={{ flex: 1 }}
              >
                <UserX size={13} style={{ marginRight: 6 }} />
                Deactivate
              </button>
              <button
                className={'btn btn-sm ' + (action === 'delete' ? 'btn-danger' : 'btn-secondary')}
                onClick={() => setAction('delete')}
                style={{ flex: 1 }}
              >
                <Trash2 size={13} style={{ marginRight: 6 }} />
                Permanent Delete
              </button>
            </div>
          </div>

          {/* Warning */}
          <div style={{ background: isDelete ? 'var(--bg-tertiary)' : '#141008', border: `1px solid ${isDelete ? '#ef444430' : '#f59e0b30'}`, borderRadius: 8, padding: 12, marginBottom: 16, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {isDelete ? (
              <>
                <span style={{ color: '#ef4444', fontWeight: 600 }}>Permanent delete — irreversible.</span> This will remove the user record from the database, revoke all roles, unlink all accounts, deprovision from all connected systems, and trigger an email notification to the admin team.
              </>
            ) : (
              <>
                <span style={{ color: '#f59e0b', fontWeight: 600 }}>Deactivate — reversible.</span> This sets the user to inactive, revokes all active roles, and triggers deprovisioning from connected systems. The user record is retained and can be reactivated.
              </>
            )}
          </div>

          <div className="form-group">
            <label>Business Justification <span style={{ color: '#ef4444' }}>*</span></label>
            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={3}
              placeholder="Why is this action being taken? Required for audit trail and email notification."
              autoFocus
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${isDelete ? 'btn-danger' : 'btn-warning'}`}
            onClick={handleSubmit}
            disabled={loading || !justification.trim()}
          >
            {loading ? 'Processing...' : isDelete ? 'Delete User' : 'Deactivate User'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Edit User Modal ───────────────────────────────────────────────────────────
function EditUserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    first_name: user.first_name || '',
    last_name:  user.last_name  || '',
    email:      user.email      || '',
    department: user.department || '',
    title:      user.title      || '',
    phone:      user.phone      || '',
    location:   user.location   || '',
    status:     user.status     || 'active'});
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await API.put(`/users/${user.id}`, form);
      toast.success('User updated successfully');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update user');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Edit User — {user.username}</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row form-row-2">
              <div className="form-group"><label>First Name *</label><input value={form.first_name} onChange={e=>set('first_name',e.target.value)} required /></div>
              <div className="form-group"><label>Last Name</label><input value={form.last_name} onChange={e=>set('last_name',e.target.value)} /></div>
            </div>
            <div className="form-row form-row-2">
              <div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={e=>set('email',e.target.value)} required /></div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={e=>set('status',e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            </div>
            <div className="form-row form-row-2">
              <div className="form-group"><label>Department</label><input value={form.department} onChange={e=>set('department',e.target.value)} /></div>
              <div className="form-group"><label>Title</label><input value={form.title} onChange={e=>set('title',e.target.value)} /></div>
            </div>
            <div className="form-row form-row-2">
              <div className="form-group"><label>Phone</label><input value={form.phone} onChange={e=>set('phone',e.target.value)} /></div>
              <div className="form-group"><label>Location</label><input value={form.location} onChange={e=>set('location',e.target.value)} /></div>
            </div>
            <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, color: 'var(--text-secondary)' }}>
              Note: Setting status to <strong style={{ color: '#f59e0b' }}>Inactive</strong> will trigger deprovisioning from all connected systems.
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Bulk action modal
function BulkActionModal({ count, onClose, onDone, selectedIds }) {
  const [action, setAction] = useState('deactivate');
  const [justification, setJustification] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const isDelete = action === 'delete';

  const handleSubmit = async () => {
    if (!justification.trim()) { toast.error('Business justification is required'); return; }
    setLoading(true);
    let ok = 0;
    for (const id of selectedIds) {
      try {
        const url = isDelete ? `/users/${id}?hard=true` : `/users/${id}`;
        await API.delete(url, { data: { justification: justification.trim() } });
        ok++;
        setProgress(ok);
      } catch {}
    }
    setLoading(false);
    toast.success(`${ok} user(s) ${isDelete ? 'deleted' : 'deactivated'}`);
    onDone();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontWeight: 600, color: '#ef4444' }}>Bulk User Action — {count} users</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Action</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={'btn btn-sm ' + (action === 'deactivate' ? 'btn-warning' : 'btn-secondary')} onClick={() => setAction('deactivate')} style={{ flex: 1 }}>
                <UserX size={13} style={{ marginRight: 6 }} />Deactivate
              </button>
              <button className={'btn btn-sm ' + (action === 'delete' ? 'btn-danger' : 'btn-secondary')} onClick={() => setAction('delete')} style={{ flex: 1 }}>
                <Trash2 size={13} style={{ marginRight: 6 }} />Permanent Delete
              </button>
            </div>
          </div>
          <div style={{ background: isDelete ? 'var(--bg-tertiary)' : '#141008', border: `1px solid ${isDelete ? '#ef444430' : '#f59e0b30'}`, borderRadius: 8, padding: 12, marginBottom: 14, color: 'var(--text-secondary)' }}>
            {isDelete
              ? <><span style={{ color: '#ef4444', fontWeight: 600 }}>Permanent delete</span> — {count} users will be permanently removed from the database with full deprovision.</>
              : <><span style={{ color: '#f59e0b', fontWeight: 600 }}>Deactivate</span> — {count} users will be set to inactive and deprovisioned from all connected systems.</>
            }
          </div>
          <div className="form-group">
            <label>Business Justification <span style={{ color: '#ef4444' }}>*</span></label>
            <textarea value={justification} onChange={e => setJustification(e.target.value)} rows={3} placeholder="Required for audit trail..." autoFocus />
          </div>
          {loading && (
            <div style={{ color: 'var(--text-muted)', marginTop: 8 }}>
              Processing {progress} / {count}…
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
          <button className={`btn ${isDelete ? 'btn-danger' : 'btn-warning'}`} onClick={handleSubmit} disabled={loading || !justification.trim()}>
            {loading ? 'Processing...' : `${isDelete ? 'Delete' : 'Deactivate'} ${count} Users`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RolesHierarchyTab — SailPoint IIQ style Business→IT→Entitlements ─────────
function RolesHierarchyTab({ roles }) {
  const [expandedRoles, setExpandedRoles] = useState({});
  const [expandedITRoles, setExpandedITRoles] = useState({});

  const toggle = (id, setter) => setter(prev => ({ ...prev, [id]: !prev[id] }));

  const typeColor = { business: '#8b5cf6', birthright: '#06b6d4', it: '#10b981', system: '#f59e0b' };
  const typeIcon  = { business: '💼', birthright: '🎯', it: '⚙️', system: '🔧' };

  if (!roles || roles.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🛡️</div>
        No roles assigned to this identity.
      </div>
    );
  }

  // Separate by type for display order: birthright → business → it → system
  const order = ['birthright', 'business', 'it', 'system'];
  const sorted = [...roles].sort((a, b) => (order.indexOf(a.type) - order.indexOf(b.type)) || a.name.localeCompare(b.name));

  const EntitlementRow = ({ e }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: '#10b981', fontSize: 12 }}>🔑</span>
      <div style={{ flex: 1 }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{e.display_name || e.name}</span>
        {e.value && e.value !== e.name && <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 8 }}>{e.value}</span>}
      </div>
      <span style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>{e.type}</span>
      {e.application_name && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{e.application_name}</span>}
    </div>
  );

  return (
    <div>
      {sorted.map(role => {
        const color = typeColor[role.type] || '#94a3b8';
        const icon  = typeIcon[role.type]  || '🛡️';
        const isExpanded = expandedRoles[role.id];
        const hasChildren = (role.child_roles?.length > 0) || (role.entitlements?.length > 0);
        const totalEnts = role.entitlements?.length + (role.child_roles?.reduce((s, cr) => s + (cr.entitlements?.length || 0), 0) || 0);

        return (
          <div key={role.id} style={{ border: `1px solid ${color}30`, borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
            {/* Role header */}
            <div
              onClick={() => hasChildren && toggle(role.id, setExpandedRoles)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: `${color}08`, cursor: hasChildren ? 'pointer' : 'default' }}
            >
              <span style={{ fontSize: 18 }}>{icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{role.name}</span>
                  <span style={{ background: `${color}20`, color, borderRadius: 4, padding: '1px 7px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>{role.type}</span>
                  {totalEnts > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{totalEnts} entitlement{totalEnts !== 1 ? 's' : ''}</span>}
                </div>
                {role.description && <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>{role.description}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {role.assigned_by_name && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Assigned by {role.assigned_by_name}</span>}
                {role.expires_at && <span style={{ color: '#f59e0b', fontSize: 12 }}>Expires {new Date(role.expires_at).toLocaleDateString()}</span>}
                {hasChildren && <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>{isExpanded ? '▾' : '▸'}</span>}
              </div>
            </div>

            {/* Expanded: direct entitlements + child IT roles */}
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${color}20` }}>
                {/* Direct entitlements on this role */}
                {role.entitlements?.length > 0 && (
                  <div>
                    <div style={{ padding: '6px 16px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Direct Entitlements ({role.entitlements.length})
                    </div>
                    {role.entitlements.map(e => <EntitlementRow key={e.id} e={e} />)}
                  </div>
                )}

                {/* Child IT roles */}
                {role.child_roles?.map(cr => {
                  const crExpanded = expandedITRoles[cr.id];
                  return (
                    <div key={cr.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <div
                        onClick={() => cr.entitlements?.length > 0 && toggle(cr.id, setExpandedITRoles)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 10px 32px', background: 'rgba(16,185,129,0.04)', cursor: cr.entitlements?.length > 0 ? 'pointer' : 'default' }}
                      >
                        <span>⚙️</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{cr.name}</span>
                            <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>IT Role</span>
                            {cr.entitlements?.length > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{cr.entitlements.length} entitlement{cr.entitlements.length !== 1 ? 's' : ''}</span>}
                          </div>
                          {cr.description && <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 1 }}>{cr.description}</div>}
                        </div>
                        {cr.entitlements?.length > 0 && <span style={{ color: 'var(--text-muted)' }}>{crExpanded ? '▾' : '▸'}</span>}
                      </div>
                      {crExpanded && cr.entitlements?.map(e => (
                        <div key={e.id} style={{ paddingLeft: 20 }}>
                          <EntitlementRow e={e} />
                        </div>
                      ))}
                    </div>
                  );
                })}

                {role.entitlements?.length === 0 && role.child_roles?.length === 0 && (
                  <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>No entitlements or IT roles linked to this role.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Identity Detail Modal — 6 tabs ───────────────────────────────────────────
function IdentityDetailModal({ user, activeTab, onTabChange, onClose }) {
  const [data, setData]       = useState({});
  const [loading, setLoading] = useState(true);

  const TABS = [
    { key: 'attributes',   label: 'Attributes' },
    { key: 'roles',        label: 'Roles' },
    { key: 'entitlements', label: 'Entitlements' },
    { key: 'accounts',     label: 'Application Accounts' },
    { key: 'rights',       label: 'User Rights' },
    { key: 'events',       label: 'Events' },
    { key: 'requests',     label: 'Access Requests' },
  ];

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [lcRes, acctRes, wgRes, entRes, rolesRes] = await Promise.allSettled([
          API.get(`/lifecycle-events/user/${user.id}`),
          API.get(`/account-links`, { params: { user_id: user.id, limit: 50 } }),
          API.get(`/workgroups`, { params: { member_user_id: user.id, limit: 100 } }),
          API.get(`/users/${user.id}/entitlements`),
          API.get(`/users/${user.id}/roles`),
        ]);
        if (!cancelled) {
          setData({
            lifecycle:    lcRes.status === 'fulfilled' ? (lcRes.value.data?.data || []) : [],
            accounts:     acctRes.status === 'fulfilled' ? (acctRes.value.data?.data || acctRes.value.data || []) : [],
            workgroups:   wgRes.status === 'fulfilled' ? (wgRes.value.data?.data || wgRes.value.data || []) : [],
            entitlements: entRes.status === 'fulfilled' ? (entRes.value.data?.data || []) : [],
            roles:        rolesRes.status === 'fulfilled' ? (rolesRes.value.data?.data || []) : [],
          });
        }
      } catch {}
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [user.id]);

  const tabBtn = (key, label) => (
    <button key={key} onClick={() => onTabChange(key)}
      style={{
        background: activeTab === key ? 'rgba(56,189,248,0.1)' : 'none',
        border: 'none', borderBottom: `2px solid ${activeTab === key ? '#38bdf8' : 'transparent'}`,
        color: activeTab === key ? '#38bdf8' : 'var(--text-muted)',
        padding: '8px 16px', cursor: 'pointer', fontWeight: activeTab === key ? 600 : 400,
        transition: 'all 0.15s', whiteSpace: 'nowrap' }}
    >{label}</button>
  );

  // Standard fixed attributes always shown
  const identityAttrs = [
    ['Username', user.username],
    ['Email', user.email],
    ['First Name', user.first_name],
    ['Last Name', user.last_name],
    ['Department', user.department],
    ['Job Title', user.job_title || user.title],
    ['Employee ID', user.employee_id],
    ['Status', user.status],
    ['Correlated', user.correlated ? 'Yes' : 'No'],
    ['Risk Score', user.risk_score || '0'],
    ['User Type', user.user_type || 'identity'],
    ['Last Refresh', user.last_refresh ? new Date(user.last_refresh).toLocaleString() : '—'],
    ['Last Login', user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'],
    ['MFA Enabled', user.mfa_enabled ? 'Yes' : 'No'],
    ['Created', user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'],
  ];
  // Extended attributes from identity_source_mappings (written during aggregation)
  const extendedAttrs = Object.entries(user.identity_attributes || {})
    .filter(([k]) => !['_sourceConnector','_sourceRecord'].includes(k))
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]);

  const EVENT_COLORS = {
    JOINER: '#10b981', LEAVER: '#ef4444', MOVER: '#f59e0b', REHIRE: '#8b5cf6',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 820, width: '97%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,#06b6d4,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {user.first_name?.[0]}{user.last_name?.[0]}
            </div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{user.first_name} {user.last_name}</div>
              <div style={{ color: 'var(--text-muted)' }}>{user.email} · {user.username}</div>
            </div>
            <div style={{ marginLeft: 8, display: 'flex', gap: 6 }}>
              {user.correlated && <span style={{ background:'rgba(16,185,129,0.15)', color:'#34d399', borderRadius:4, padding:'2px 8px', fontWeight:600 }}>Correlated</span>}
              <span className={`badge badge-${user.status === 'active' ? 'success' : 'gray'}`}>{user.status}</span>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e2a3a', flexShrink: 0, overflowX: 'auto', background: '#131f2e' }}>
          {TABS.map(t => tabBtn(t.key, t.label))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading && activeTab !== 'attributes' && activeTab !== 'rights' && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Loading…</div>
          )}

          {/* Attributes Tab */}
          {activeTab === 'attributes' && (
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {identityAttrs.map(([k, v]) => v && v !== 'undefined' ? (
                    <tr key={k} style={{ borderBottom: '1px solid #1a2332' }}>
                      <td style={{ padding: '7px 0', color: 'var(--text-muted)', width: '35%' }}>{k}</td>
                      <td style={{ padding: '7px 0', color: 'var(--text-primary)' }}>{v || '—'}</td>
                    </tr>
                  ) : null)}
                </tbody>
              </table>
              {/* Extended attributes from Identity Mapping source mappings */}
              <div style={{ marginTop: 16 }}>
                <div style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Extended Attributes <span style={{ color:'var(--text-secondary)', fontWeight:400, textTransform:'none' }}>(from Identity Mapping)</span>
                </div>
                {extendedAttrs.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', padding: '8px 0' }}>
                    No extended attributes yet. Configure source mappings in{' '}
                    <strong style={{ color:'var(--text-secondary)' }}>Global Settings → Identity Mapping</strong>{' '}
                    and re-run aggregation.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {extendedAttrs.map(([k, v]) => (
                        <tr key={k} style={{ borderBottom: '1px solid #1a2332' }}>
                          <td style={{ padding: '7px 0', color: 'var(--text-muted)', width: '35%', fontFamily: 'monospace' }}>{k}</td>
                          <td style={{ padding: '7px 0', color: 'var(--text-primary)' }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Roles Tab — SailPoint IIQ style hierarchy */}
          {activeTab === 'roles' && !loading && (
            <RolesHierarchyTab roles={data.roles || []} />
          )}

          {/* Entitlements Tab */}
          {activeTab === 'entitlements' && !loading && (
            <div>
              {(!data.entitlements || data.entitlements.length === 0) ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🔑</div>
                  No entitlements found. Run aggregation to discover access.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid #1e2a3a' }}>
                      {['Application', 'Type', 'Name / Value', 'Requestable', 'Elevated', 'Last Seen'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.entitlements.map(e => (
                      <tr key={e.id} style={{ borderBottom: '1px solid #1e2a3a' }}>
                        <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>{e.application_name}</td>
                        <td style={{ padding: '9px 12px' }}>
                          <span style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399', borderRadius: 4, padding: '2px 6px' }}>{e.type}</span>
                        </td>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ color: 'var(--text-primary)' }}>{e.name}</div>
                          <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{e.value}</div>
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                          {e.requestable ? <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span> : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                          {e.elevated_access ? <span style={{ color: '#f59e0b' }}>⚡</span> : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>
                          {e.last_seen_at ? new Date(e.last_seen_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Application Accounts Tab */}
          {activeTab === 'accounts' && !loading && (
            <div>
              {!data.accounts?.length && (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No correlated accounts found for this identity.</div>
              )}
              {(data.accounts || []).map(acct => (
                <div key={acct.id} style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: 14, marginBottom: 10, border: '1px solid #1e2a3a' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                        {acct.resolved_account_name || acct.display_name || acct.account_name || acct.native_identity || '—'}
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        {acct.application_name || acct.connector_name || '—'}
                        {acct.native_identity && acct.resolved_account_name !== acct.native_identity &&
                          <span style={{ marginLeft: 6, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>({acct.native_identity})</span>
                        }
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className={`badge badge-${acct.status === 'active' ? 'success' : 'gray'}`}>{acct.status || 'active'}</span>
                      {acct.last_seen_at && <span style={{ color: 'var(--text-secondary)' }}>Last seen {new Date(acct.last_seen_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  {/* Source record dump */}
                  {acct.source_record && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>Source attributes ▾</summary>
                      <pre style={{ background: 'var(--bg-primary)', borderRadius: 6, padding: 10, marginTop: 8, color: 'var(--text-secondary)', overflowX: 'auto', maxHeight: 200 }}>
                        {JSON.stringify(acct.source_record, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* User Rights Tab */}
          {activeTab === 'rights' && (
            <div>

              <div>
                <div style={{ color: '#38bdf8', fontWeight: 600, marginBottom: 10 }}>Assigned Workgroups</div>
                {(!data.workgroups || data.workgroups.length === 0)
                  ? <div style={{ color: 'var(--text-secondary)' }}>Not a member of any workgroups.</div>
                  : (data.workgroups || []).map(wg => (
                    <div key={wg.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, marginBottom: 6 }}>
                      <span style={{ }}>👥</span>
                      <div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{wg.name}</div>
                        {wg.description && <div style={{ color: 'var(--text-muted)' }}>{wg.description}</div>}
                        {(wg.capabilities || []).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {(wg.capabilities || []).map(cap => (
                              <span key={cap} style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', borderRadius: 4, padding: '1px 6px' }}>{cap.replace(/_/g,' ')}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* Events Tab */}
          {activeTab === 'events' && !loading && (
            <div>
              {!data.lifecycle?.length
                ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No lifecycle events recorded for this identity.</div>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid #1e2a3a' }}>
                        {['Event', 'Triggered By', 'Changed Attributes', 'Date'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.lifecycle.map(ev => (
                        <tr key={ev.id} style={{ borderBottom: '1px solid #1e2a3a' }}>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ background: `${EVENT_COLORS[ev.event_type] || 'var(--text-muted)'}20`, color: EVENT_COLORS[ev.event_type] || 'var(--text-muted)', borderRadius: 4, padding: '3px 8px', fontWeight: 700 }}>
                              {ev.event_type}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{ev.triggered_by || '—'}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                            {Object.keys(ev.changed_attributes || {}).join(', ') || '—'}
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                            {new Date(ev.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </div>
          )}

          {/* Access Requests Tab */}
          {activeTab === 'requests' && !loading && (
            <UserAccessRequests userId={user.id} />
          )}
        </div>

        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}



// ── User Access Requests Component ────────────────────────────────────────────
function UserAccessRequests({ userId }) {
  const [requests, setRequests] = React.useState([]);
  const [loading, setLoading]   = React.useState(true);

  React.useEffect(() => {
    if (!userId) return;
    // Fetch requests where this user is the target or requester
    Promise.all([
      API.get(`/access-requests?limit=50`).catch(()=>({ data: { data: [] } }))
    ]).then(([res]) => {
      const all = res.data?.data || [];
      const mine = all.filter(r => r.target_user_id === userId || r.requester_id === userId);
      setRequests(mine);
    }).finally(() => setLoading(false));
  }, [userId]);

  const statusColor = { approved:'#10b981', rejected:'#ef4444', pending:'#f59e0b', cancelled:'#64748b', expired:'#94a3b8' };

  if (loading) return <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)' }}>Loading...</div>;

  if (!requests.length) return (
    <div style={{ textAlign:'center', padding:32, background:'var(--bg-tertiary)', borderRadius:8 }}>
      <div style={{ fontSize:24, marginBottom:8 }}>📋</div>
      <div style={{ color:'var(--text-muted)' }}>No access requests found for this identity.</div>
    </div>
  );

  return (
    <div>
      <table>
        <thead><tr>
          <th>Ticket</th>
          <th>Resource</th>
          <th>Type</th>
          <th>Status</th>
          <th>Provisioned</th>
          <th>Date</th>
        </tr></thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.id}>
              <td style={{ fontWeight:600, color:'var(--accent)' }}>{r.ticket_number}</td>
              <td>
                <div style={{ fontWeight:500, color:'var(--text-primary)' }}>{r.resource_name||'—'}</div>
                <div style={{ color:'var(--text-muted)' }}>{r.justification?.slice(0,50)}{r.justification?.length>50?'...':''}</div>
              </td>
              <td style={{ }}><span className="badge badge-info">{r.request_type?.replace('_',' ')}</span></td>
              <td><span className="badge" style={{ background:`${statusColor[r.status]}20`, color:statusColor[r.status], border:`1px solid ${statusColor[r.status]}40` }}>{r.status}</span></td>
              <td style={{ color:'var(--text-muted)' }}>
                {r.provisioning_status === 'success' || r.provisioning_status === 'successful' ? (
                  <span style={{ color:'#10b981', fontWeight:500 }}>✓ Provisioned</span>
                ) : r.provisioning_status === 'failed' ? (
                  <span style={{ color:'#ef4444', fontWeight:500 }}>✗ Failed</span>
                ) : r.provisioning_status === 'partial_success' ? (
                  <span style={{ color:'#f59e0b', fontWeight:500 }}>⚠ Partial</span>
                ) : r.provisioning_status ? (
                  <span>{r.provisioning_status}</span>
                ) : '—'}
              </td>
              <td style={{ color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                {r.requested_at ? new Date(r.requested_at).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [actionTarget, setActionTarget] = useState(null);   // single-user action
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [identityDetail, setIdentityDetail] = useState(null); // user for detail modal
  const [identityDetailTab, setIdentityDetailTab] = useState('attributes');
  const [limit, setLimit] = useState(15);

  const allSelected = users.length > 0 && users.every(u => selected.has(u.id));
  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (allSelected) { setSelected(prev => { const n = new Set(prev); users.forEach(u => n.delete(u.id)); return n; }); }
    else { setSelected(prev => { const n = new Set(prev); users.forEach(u => n.add(u.id)); return n; }); }
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await API.get(`/users?${params}`);
      setUsers(data.data);
      setTotal(data.total);
    } catch { toast.error('Failed to load users'); }
    finally { setLoading(false); }
  }, [page, limit, search, statusFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const exportCSV = async () => {
    try {
      const res = await API.get('/reports/user-access?format=csv', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  const onActionDone = () => { setSelected(new Set()); fetchUsers(); };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Users</div>
          <div className="page-subtitle">{total} total identities</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={exportCSV}><Download size={14} /> Export</button>
          <button className="btn btn-secondary" onClick={fetchUsers}><RefreshCw size={14} /></button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14} /> New User</button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#0f2744', border: '1px solid #1d4ed8', borderRadius: 8, marginBottom: 12 }}>
          <span style={{ color: '#93c5fd', fontWeight: 600 }}>{selected.size} user{selected.size > 1 ? 's' : ''} selected</span>
          <button className="btn btn-warning btn-sm" onClick={() => setShowBulkModal(true)}>
            <UserX size={13} style={{ marginRight: 4 }} />Deactivate / Delete Selected
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div className="search-bar">
          <div className="search-input-wrap" style={{ flex: 1 }}>
            <Search size={14} className="search-icon" />
            <input placeholder="Search by name, email, or username..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} style={{ width: 140 }}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="locked">Locked</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: 'auto' }} /></div>
        ) : users.length === 0 ? (
          <div className="empty-state"><p>No users found</p></div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                  <th>User</th>
                  <th>Correlated</th>
                  <th>Manager</th>
                  <th>Department</th>
                  <th>Roles</th>
                  <th>MFA</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Last Login</th>
                  <th>Source</th>
                  <th style={{ width: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ background: selected.has(u.id) ? '#0a1628' : undefined }}>
                    <td style={{ width: 40, textAlign: 'center' }}>
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} onClick={e => e.stopPropagation()} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                          {u.first_name?.[0]}{u.last_name?.[0]}
                        </div>
                        <div>
                          <button onClick={() => { setIdentityDetail(u); setIdentityDetailTab('attributes'); }}
                            style={{ background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left' }}>
                            <div style={{ fontWeight: 500, color: '#38bdf8' }}>{u.first_name} {u.last_name}</div>
                          </button>
                          <div style={{ color: 'var(--text-muted)' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign:'center' }}>
                      {u.correlated
                        ? <span style={{ background:'rgba(16,185,129,0.15)', color:'#34d399', borderRadius:4, padding:'2px 8px', fontWeight:600 }}>✓</span>
                        : <span style={{ color:'var(--text-secondary)' }}>—</span>}
                    </td>
                    <td style={{ color:'var(--text-secondary)' }}>{u.manager_name || '—'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{u.department || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {(u.roles || []).slice(0, 2).map(r => <span key={r} className="badge badge-info">{r}</span>)}
                        {u.roles?.length > 2 && <span className="badge badge-gray">+{u.roles.length - 2}</span>}
                        {!u.roles?.length && <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                      </div>
                    </td>
                    <td><span className={`badge ${u.mfa_enabled ? 'badge-success' : 'badge-gray'}`}>{u.mfa_enabled ? 'ON' : 'OFF'}</span></td>
                    <td><span className={`badge badge-${statusColor[u.status] || 'gray'}`}>{u.status}</span></td>
                    <td style={{ color: 'var(--text-muted)' }}>{u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</td>
                    <td>
                      {u.risk_score > 0
                        ? <span style={{ background: u.risk_score >= 75 ? 'rgba(239,68,68,0.15)' : u.risk_score >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
                                         color: u.risk_score >= 75 ? '#ef4444' : u.risk_score >= 40 ? '#f59e0b' : '#34d399',
                                         borderRadius:4, padding:'2px 8px', fontWeight:700 }}>{u.risk_score}</span>
                        : <span style={{ color:'var(--text-secondary)' }}>—</span>}
                    </td>
                    <td><span className="badge badge-gray">{u.source}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-secondary btn-sm" title="Edit" onClick={() => setEditTarget(u)}><Edit size={12} /></button>
                        <button
                          className="btn btn-warning btn-sm"
                          title="Deactivate or Delete"
                          onClick={() => setActionTarget(u)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <UserX size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Pagination */}

            <div style={{ padding: '12px 16px', borderTop: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Pagination page={page} total={total} limit={limit} onPageChange={setPage} onLimitChange={(l)=>{setLimit(l);setPage(1);}}/>
            </div>
          </>
        )}
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={fetchUsers} />}
      {editTarget && <EditUserModal user={editTarget} onClose={() => setEditTarget(null)} onSaved={fetchUsers} />}

      {identityDetail && (
        <IdentityDetailModal
          user={identityDetail}
          activeTab={identityDetailTab}
          onTabChange={setIdentityDetailTab}
          onClose={() => setIdentityDetail(null)}
        />
      )}

      {actionTarget && (
        <UserActionModal
          user={actionTarget}
          onClose={() => setActionTarget(null)}
          onDone={onActionDone}
        />
      )}

      {showBulkModal && (
        <BulkActionModal
          count={selected.size}
          selectedIds={[...selected]}
          onClose={() => setShowBulkModal(false)}
          onDone={onActionDone}
        />
      )}
    </div>
  );
}
