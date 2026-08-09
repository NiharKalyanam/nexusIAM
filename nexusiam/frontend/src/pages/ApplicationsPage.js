import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw, Link2, Trash2, ChevronDown, ChevronRight, Database, Shield, Users, Tag, CheckCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import API from '../utils/api';
import PaginationControls from '../components/PaginationControls';
import OwnerPicker from '../components/OwnerPicker';
import { useAuth } from '../context/AuthContext';

const emptyForm = {
  name: '', description: '', type: 'saas', status: 'active', sso_enabled: false,
  sso_protocol: 'oidc', provisioning_enabled: true, provisioning_type: 'connector',
  metadata: { connector_id: '' }, provisioning_config: {},
  owner: null, is_authoritative: false, is_sox: false, is_birthright: false,
};

function DeleteAppModal({ app, onClose, onConfirm }) {
  const [justification, setJustification] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!justification.trim()) { toast.error('Business justification is required'); return; }
    setLoading(true);
    try { await onConfirm(app, justification.trim()); onClose(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed to delete'); setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trash2 size={16} /> Delete Application
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid #ef444430', borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ color: '#ef4444', fontWeight: 600, marginBottom: 6 }}>This action is irreversible</div>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Deleting <strong style={{ color: 'var(--text-primary)' }}>{app.name}</strong> will permanently remove all aggregated accounts, entitlements, schema, attribute mappings, SCIM tokens, sync history, and the linked connector (if not shared).
            </div>
          </div>
          <div className="form-group">
            <label>Business Justification <span style={{ color: '#ef4444' }}>*</span></label>
            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={3}
              placeholder="Why is this application being deleted? (required for audit trail)"
              autoFocus
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={handleSubmit} disabled={loading || !justification.trim()}>
            {loading ? 'Deleting...' : 'Confirm Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountRow({ account, isExpanded, onToggle }) {
  const attrs = account.attributes || {};
  const accessItems = Array.isArray(account.access_items) ? account.access_items : [];
  const statusColor = account.status === 'active' ? '#10b981' : account.status === 'inactive' ? '#ef4444' : 'var(--text-secondary)';

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td style={{ width: 36, paddingLeft: 12 }}>
          {isExpanded
            ? <ChevronDown size={15} style={{ color: '#06b6d4' }} />
            : <ChevronRight size={15} style={{ color: 'var(--text-muted)' }} />}
        </td>
        <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
          {account.native_identity || account.id?.slice(0, 8) || '—'}
        </td>
        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {account.display_name || account.account_name || account.native_identity}
        </td>
        <td>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
            <span style={{ color: statusColor, textTransform: 'capitalize', fontWeight: 500 }}>{account.status || 'unknown'}</span>
          </span>
        </td>
        <td style={{ color: 'var(--text-muted)' }}>
          {account.last_aggregated_at ? new Date(account.last_aggregated_at).toLocaleDateString() : '—'}
        </td>
        <td style={{ }}>
          {account.linked_email || account.linked_username
            ? <span style={{ color: '#06b6d4' }}>{account.linked_email || account.linked_username}</span>
            : <span style={{ color: 'var(--text-secondary)' }}>Unlinked</span>}
        </td>
        <td>
          <span className="badge badge-info" style={{ }}>{account.access_count || 0} items</span>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} style={{ background: '#020817', padding: 0, borderBottom: '2px solid #1e293b' }}>
            <div style={{ padding: '16px 20px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>Account Attributes</div>
                <div style={{ background: 'var(--bg-primary)', border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden' }}>
                  {Object.keys(attrs).length === 0
                    ? <div style={{ color: 'var(--text-secondary)', padding: '10px 14px' }}>No attributes stored</div>
                    : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>
                          {Object.entries(attrs).map(([k, v], i) => (
                            <tr key={k} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1424' }}>
                              <td style={{ color: 'var(--text-muted)', padding: '5px 12px', whiteSpace: 'nowrap', width: '38%', borderRight: '1px solid #1e293b', fontWeight: 500 }}>{k}</td>
                              <td style={{ color: 'var(--text-secondary)', padding: '5px 12px', wordBreak: 'break-word' }}>
                                {typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>
                  Access / Entitlements ({accessItems.length})
                </div>
                <div style={{ background: 'var(--bg-primary)', border: '1px solid #1e293b', borderRadius: 8, minHeight: 60, padding: 12 }}>
                  {accessItems.length === 0
                    ? <div style={{ color: 'var(--text-secondary)' }}>No access items found</div>
                    : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {accessItems.map((item, i) => (
                          <span key={i} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            background: '#0f2744', border: '1px solid #1d4ed8',
                            borderRadius: 20, padding: '3px 10px'
                          }}>
                            <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{item.type}</span>
                            <span style={{ color: '#93c5fd' }}>{item.display_name || item.value}</span>
                          </span>
                        ))}
                      </div>
                    )}
                </div>
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ background: 'var(--bg-primary)', border: '1px solid #1e293b', borderRadius: 6, padding: '8px 12px' }}>
                    <div style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 3 }}>Identity</div>
                    <div style={{ color: 'var(--text-primary)' }}>{account.linked_email || account.linked_username || '—'}</div>
                  </div>
                  <div style={{ background: 'var(--bg-primary)', border: '1px solid #1e293b', borderRadius: 6, padding: '8px 12px' }}>
                    <div style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 3 }}>Correlation</div>
                    <div style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{account.correlation_value || '—'}</div>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ApplicationsPage() {
  const { user } = useAuth();
  const [apps, setApps] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedApp, setSelectedApp] = useState(null);
  const [detailTab, setDetailTab] = useState('details');
  const [appPolicies, setAppPolicies] = useState([]);
  const [appPoliciesLoading, setAppPoliciesLoading] = useState(false);
  const [activePolicyOp, setActivePolicyOp] = useState('Create');
  const [policyFields, setPolicyFields] = useState([]);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [appAccounts, setAppAccounts] = useState([]);
  const [appEntitlements, setAppEntitlements] = useState([]);
  const [appSchema, setAppSchema] = useState([]);
  const [schemaSource, setSchemaSource] = useState('');
  const [expandedAccounts, setExpandedAccounts] = useState({});
  const [appAccountsPagination, setAppAccountsPagination] = useState({ page: 1, pages: 0, limit: 20, total: 0 });
  const [appAccountsLimit, setAppAccountsLimit] = useState(20);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loadingTab, setLoadingTab] = useState(false);

  const isSuperAdmin = (user?.roles || []).includes('Super Admin');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([API.get('/applications'), API.get('/connectors')]);
      setApps(a.data || []);
      setConnectors(c.data || []);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const loadAppAccounts = async (appId, page = 1, limit = 20) => {
    const { data } = await API.get('/applications/' + appId + '/accounts', { params: { page, limit } });
    setAppAccounts(data.accounts || []);
    setAppAccountsPagination(data.pagination || { page, pages: 0, limit, total: 0 });
  };

  const loadAccountDetails = async (appId, accountId) => {
    try {
      const { data } = await API.get('/applications/' + appId + '/accounts/' + accountId);
      setAppAccounts(prev => prev.map(a => a.id === accountId ? { ...a, ...(data.account || {}), _detailsLoaded: true } : a));
    } catch { toast.error('Failed to load account details'); }
  };

  const toggleAccount = async (accountId) => {
    const nextOpen = !expandedAccounts[accountId];
    setExpandedAccounts(prev => ({ ...prev, [accountId]: nextOpen }));
    if (!nextOpen || !selectedApp) return;
    const existing = appAccounts.find(a => a.id === accountId);
    if (!existing?._detailsLoaded) await loadAccountDetails(selectedApp.id, accountId);
  };

  const loadAppSchema = async (appId) => {
    const { data } = await API.get('/applications/' + appId + '/schema');
    setAppSchema(data.schema || []);
    setSchemaSource(data.source || '');
  };

  const loadAppEntitlements = async (appId) => {
    const { data } = await API.get('/applications/' + appId + '/entitlements');
    setAppEntitlements(data.entitlements || []);
  };

  const openApp = async (app) => {
    setSelectedApp(app);
    setDetailTab('details');
    setExpandedAccounts({});
    setAppSchema([]); setAppEntitlements([]); setAppAccounts([]); setAppPolicies([]);
    setLoadingTab(true);
    try {
      const connectorId = app.metadata?.connector_id || app.provisioning_config?.connector_id || null;
      await Promise.all([
        loadAppSchema(app.id),
        loadAppAccounts(app.id, 1, appAccountsLimit),
        loadAppEntitlements(app.id),
        loadAppPolicies(connectorId),
      ]);
    } finally { setLoadingTab(false); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const connectorId = form.metadata?.connector_id || null;
      const payload = {
        ...form,
        metadata: { ...(form.metadata || {}), connector_id: connectorId },
        provisioning_config: { ...(form.provisioning_config || {}), connector_id: connectorId },
        owner_id: form.owner?.id || null,
        owner_type: form.owner?.type || 'identity',
        owner_workgroup_id: (form.owner?.type === 'workgroup' ? form.owner?.id : null) || null,
        is_authoritative: !!form.is_authoritative,
        is_sox: !!form.is_sox,
        is_birthright: !!form.is_birthright,
      };
      if (editingId) {
        await API.put('/applications/' + editingId, payload);
        toast.success('Application updated');
      } else {
        await API.post('/applications', payload);
        toast.success('Application created');
      }
      setEditingId(null); setShowCreate(false); setForm(emptyForm);
      fetchAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const loadAppPolicies = async (connectorId) => {
    if (!connectorId) { setAppPolicies([]); return; }
    setAppPoliciesLoading(true);
    try {
      const { data } = await API.get('/provisioning-policies', { params: { connector_id: connectorId } });
      const policies = data.policies || [];
      setAppPolicies(policies);
      const firstOp = policies[0]?.operation || 'Create';
      setActivePolicyOp(firstOp);
      setPolicyFields(policies.find(p => p.operation === firstOp)?.fields || []);
      setPolicyDirty(false);
    } catch { setAppPolicies([]); }
    finally { setAppPoliciesLoading(false); }
  };

  const switchAppPolicyOp = (op) => {
    setActivePolicyOp(op);
    setPolicyFields(appPolicies.find(p => p.operation === op)?.fields || []);
    setPolicyDirty(false);
  };

  const saveAppPolicy = async (connectorId) => {
    if (!connectorId) return;
    setPolicySaving(true);
    try {
      await API.put('/provisioning-policies', { connector_id: connectorId, operation: activePolicyOp, fields: policyFields, enabled: true });
      toast.success(`${activePolicyOp} policy saved`);
      setPolicyDirty(false);
      loadAppPolicies(connectorId);
    } catch { toast.error('Failed to save policy'); }
    finally { setPolicySaving(false); }
  };

  const resetAppPolicy = async (connectorId) => {
    if (!window.confirm(`Reset ${activePolicyOp} policy to defaults?`)) return;
    try {
      await API.post('/provisioning-policies/reset', { connector_id: connectorId, operation: activePolicyOp });
      toast.success('Reset to defaults');
      loadAppPolicies(connectorId);
    } catch { toast.error('Reset failed'); }
  };

  const doDelete = async (app, justification) => {
    await API.delete('/applications/' + app.id, { data: { justification } });
    toast.success('Application deleted — all data removed');
    if (selectedApp?.id === app.id) setSelectedApp(null);
    await fetchAll();
  };

  const linkedConnectorForApp = (a) =>
    connectors.find(c => c.id === (a?.metadata?.connector_id || a?.provisioning_config?.connector_id));

  const tabBtn = (id, label, count) => (
    <button
      className={'btn ' + (detailTab === id ? 'btn-primary' : 'btn-secondary')}
      onClick={() => setDetailTab(id)}
      style={{ }}
    >
      {label}{count !== undefined ? ' (' + count + ')' : ''}
    </button>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Applications</div>
          <div className="page-subtitle">{apps.length} applications registered</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={fetchAll}><RefreshCw size={14} /></button>
          <button className="btn btn-primary" onClick={() => { setEditingId(null); setForm(emptyForm); setShowCreate(true); }}>
            <Plus size={14} /> Add Application
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
        {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading...</p> : apps.length === 0 ? (
          <div className="card"><p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No applications yet</p></div>
        ) : apps.map(a => {
          const linkedConnector = linkedConnectorForApp(a);
          return (
            <div key={a.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{a.name}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{a.description}</div>
                </div>
                <span className={'badge badge-' + (a.status === 'active' ? 'success' : 'gray')}>{a.status}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span className="badge badge-gray">{a.type}</span>
                {a.provisioning_enabled && <span className="badge badge-purple">Provisioning</span>}
                {a.is_authoritative && <span className="badge badge-success">⚡ Authoritative</span>}
                {a.is_sox && <span className="badge badge-warning">SOX</span>}
                {a.is_birthright && <span className="badge badge-info">🎯 Birthright</span>}
                {linkedConnector && (
                  <span className="badge badge-info">
                    <Link2 size={10} style={{ marginRight: 4 }} />{linkedConnector.name}
                  </span>
                )}
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 12 }}>{a.user_count || 0} linked users</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openApp(a)}>Open</button>
                <button className="btn btn-secondary btn-sm" onClick={() => {
                  setEditingId(a.id);
                  setForm({ ...emptyForm, ...a,
                    metadata: { connector_id: a.metadata?.connector_id || a.provisioning_config?.connector_id || '' },
                    owner: a.owner_id ? { id: a.owner_id, name: a.owner_name, type: a.owner_type || 'identity' } : null,
                    is_authoritative: !!a.is_authoritative,
                    is_sox: !!a.is_sox,
                    is_birthright: !!a.is_birthright});
                  setShowCreate(true);
                }}>Edit</button>
                {isSuperAdmin && (
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(a)}>
                    <Trash2 size={14} /> Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{editingId ? 'Edit Application' : 'Add Application'}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowCreate(false)}>x</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group"><label>Name *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
                <div className="form-group"><label>Description</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>

                {/* Owner + Flags */}
                <div className="form-group">
                  <label>Owner <span style={{ color:'var(--text-muted)', fontWeight:400 }}>(identity or workgroup)</span></label>
                  <OwnerPicker
                    value={form.owner}
                    onChange={owner => setForm(f => ({ ...f, owner }))}
                    placeholder="Select owner…"
                  />
                </div>
                <div style={{ display:'flex', gap:24, marginBottom:16, flexWrap:'wrap' }}>
                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', color:'var(--border-bright)' }}>
                    <input type="checkbox" checked={!!form.is_authoritative}
                      onChange={e => setForm(f => ({ ...f, is_authoritative: e.target.checked }))}
                      style={{ accentColor:'#10b981' }} />
                    <span style={{ color: form.is_authoritative ? '#10b981' : 'var(--border-bright)' }}>⚡ Authoritative Source</span>
                    <span style={{ color:'var(--text-muted)' }}>(identities created from this connector)</span>
                  </label>
                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', color:'var(--border-bright)' }}>
                    <input type="checkbox" checked={!!form.is_sox}
                      onChange={e => setForm(f => ({ ...f, is_sox: e.target.checked }))}
                      style={{ accentColor:'#fbbf24' }} />
                    <span style={{ color: form.is_sox ? '#fbbf24' : 'var(--border-bright)' }}>SOX Application</span>
                  </label>
                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', color:'var(--border-bright)' }}>
                    <input type="checkbox" checked={!!form.is_birthright}
                      onChange={e => setForm(f => ({ ...f, is_birthright: e.target.checked }))}
                      style={{ accentColor:'#06b6d4' }} />
                    <span style={{ color: form.is_birthright ? '#06b6d4' : 'var(--border-bright)' }}>🎯 Birthright Application</span>
                    <span style={{ color:'var(--text-muted)' }}>(auto-assigned to all new users)</span>
                  </label>
                </div>

                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label>App Type</label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                      {['web', 'api', 'mobile', 'desktop', 'saas', 'legacy'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>SSO Protocol</label>
                    <select value={form.sso_protocol} onChange={e => setForm({ ...form, sso_protocol: e.target.value })}>
                      {['oidc', 'saml', 'oauth2', 'ldap', 'cas'].map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label>Status</label>
                    <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                      <option value="active">active</option>
                      <option value="draft">draft</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Linked Connector</label>
                    <select value={form.metadata?.connector_id || ''} onChange={e => setForm({ ...form, metadata: { ...(form.metadata || {}), connector_id: e.target.value } })}>
                      <option value="">None</option>
                      {connectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'none', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.sso_enabled} onChange={e => setForm({ ...form, sso_enabled: e.target.checked })} /> Enable SSO
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'none', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.provisioning_enabled} onChange={e => setForm({ ...form, provisioning_enabled: e.target.checked })} /> Enable Provisioning
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Save Changes' : 'Add Application'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <DeleteAppModal
          app={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={doDelete}
        />
      )}

      {selectedApp && (
        <div className="modal-overlay" onClick={() => setSelectedApp(null)}>
          <div className="modal" style={{ maxWidth: 1200, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{selectedApp.name}</span>
                <span className={'badge badge-' + (selectedApp.status === 'active' ? 'success' : 'gray')}>{selectedApp.status}</span>
                {linkedConnectorForApp(selectedApp) && (
                  <span className="badge badge-info" style={{ }}>
                    <Link2 size={10} style={{ marginRight: 3 }} />{linkedConnectorForApp(selectedApp).name}
                  </span>
                )}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedApp(null)}>x</button>
            </div>

            <div style={{ display: 'flex', gap: 4, padding: '0 24px 0', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
              {tabBtn('details', 'Details')}
              {tabBtn('schema', 'Schema', appSchema.length || undefined)}
              {tabBtn('accounts', 'Accounts', appAccountsPagination.total || 0)}
              {linkedConnectorForApp(selectedApp) && tabBtn('policies', 'Provisioning Policies', appPolicies.filter(p => !p.is_default).length || undefined)}
            </div>

            <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              {loadingTab && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Loading...</div>}

              {!loadingTab && detailTab === 'details' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="card">
                    <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Application Info</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {[
                          ['Name', selectedApp.name],
                          ['Type', selectedApp.type],
                          ['Status', selectedApp.status],
                          ['Owner', selectedApp.owner_name || '—'],
                          ['SSO Enabled', selectedApp.sso_enabled ? 'Yes (' + selectedApp.sso_protocol + ')' : 'No'],
                          ['Provisioning', selectedApp.provisioning_enabled ? 'Yes' : 'No'],
                          ['Authoritative', selectedApp.is_authoritative ? '⚡ Yes' : 'No'],
                          ['SOX', selectedApp.is_sox ? '✓ Yes' : 'No'],
                          ['Birthright', selectedApp.is_birthright ? '🎯 Yes' : 'No'],
                          ['Description', selectedApp.description || '—'],
                        ].map(([k, v]) => (
                          <tr key={k}>
                            <td style={{ color: 'var(--text-muted)', padding: '5px 0', width: '40%' }}>{k}</td>
                            <td style={{ color: 'var(--text-primary)' }}>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="card">
                    <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Linked Connector</div>
                    {linkedConnectorForApp(selectedApp) ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>
                          {[
                            ['Name', linkedConnectorForApp(selectedApp).name],
                            ['Type', linkedConnectorForApp(selectedApp).type],
                            ['Status', linkedConnectorForApp(selectedApp).status],
                            ['Direction', linkedConnectorForApp(selectedApp).provisioning_direction || '—'],
                          ].map(([k, v]) => (
                            <tr key={k}>
                              <td style={{ color: 'var(--text-muted)', padding: '5px 0', width: '40%' }}>{k}</td>
                              <td style={{ color: 'var(--text-primary)' }}>{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ color: 'var(--text-secondary)' }}>No connector linked. Edit this application to link a connector and enable aggregation.</div>
                    )}
                  </div>
                </div>
              )}

              {!loadingTab && detailTab === 'schema' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ }}>
                      {schemaSource === 'connector_discovered'
                        ? <span style={{ color: '#10b981' }}>Schema discovered from connector ({appSchema.length} attributes)</span>
                        : schemaSource === 'connector_registry'
                        ? <span style={{ color: '#f59e0b' }}>Default schema from connector type — run Schema Discovery in the connector to get live attributes</span>
                        : <span style={{ color: '#ef4444' }}>No connector linked — cannot load schema</span>
                      }
                    </div>
                  </div>
                  <div className="card" style={{ padding: 0 }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Attribute Name</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th>Identity UID</th>
                          <th>Read Only</th>
                          <th>Custom</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appSchema.length === 0 ? (
                          <tr><td colSpan={6} style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 32 }}>
                            No schema available. Link a connector and run Schema Discovery.
                          </td></tr>
                        ) : appSchema.map((s, idx) => (
                          <tr key={s.name + '-' + idx}>
                            <td style={{ fontFamily: 'monospace', color: '#06b6d4', fontWeight: 500 }}>{s.name}</td>
                            <td><span className="badge badge-gray" style={{ }}>{s.type || 'string'}</span></td>
                            <td style={{ color: 'var(--text-secondary)' }}>{s.description || '—'}</td>
                            <td style={{ textAlign: 'center' }}>{s.isUid ? <span style={{ color: '#10b981' }}>Yes</span> : '—'}</td>
                            <td style={{ textAlign: 'center' }}>{s.readOnly ? <span style={{ color: '#f59e0b' }}>Yes</span> : '—'}</td>
                            <td style={{ textAlign: 'center' }}>{s.isCustom ? <span style={{ color: '#8b5cf6' }}>Yes</span> : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!loadingTab && detailTab === 'accounts' && (
                <div>
                  <div style={{ marginBottom: 10, color: 'var(--text-muted)' }}>
                    {appAccountsPagination.total > 0
                      ? appAccountsPagination.total + ' accounts — click a row to expand attributes'
                      : 'No accounts yet. Link a connector and run Account Aggregation.'}
                  </div>
                  <div className="card" style={{ padding: 0 }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: 36 }}></th>
                          <th>Account ID</th>
                          <th>Account Name</th>
                          <th>Status</th>
                          <th>Last Refresh</th>
                          <th>Identity Name</th>
                          <th>Access</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appAccounts.length === 0 ? (
                          <tr><td colSpan={7} style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
                            No accounts aggregated. Run Account Aggregation from the Aggregation Studio.
                          </td></tr>
                        ) : appAccounts.map(a => (
                          <AccountRow
                            key={a.id}
                            account={a}
                            appId={selectedApp.id}
                            isExpanded={!!expandedAccounts[a.id]}
                            onToggle={() => toggleAccount(a.id)}
                          />
                        ))}
                      </tbody>
                    </table>
                    <PaginationControls
                      page={appAccountsPagination.page}
                      pages={appAccountsPagination.pages}
                      limit={appAccountsPagination.limit}
                      total={appAccountsPagination.total}
                      onPageChange={async (page) => { if (selectedApp) await loadAppAccounts(selectedApp.id, page, appAccountsLimit); }}
                      onLimitChange={async (limit) => { setAppAccountsLimit(limit); if (selectedApp) await loadAppAccounts(selectedApp.id, 1, limit); }}
                    />
                  </div>
                </div>
              )}

              {/* ── Provisioning Policies Tab ──────────────────────────────── */}
              {!loadingTab && detailTab === 'policies' && (() => {
                const conn = linkedConnectorForApp(selectedApp);
                const connectorId = conn?.id;
                const OP_COLOR = { Create:'#10b981', Update:'#3b82f6', Enable:'#10b981', Disable:'#f59e0b', Delete:'#ef4444', Unlock:'#8b5cf6' };
                const currentPolicy = appPolicies.find(p => p.operation === activePolicyOp);
                const col = OP_COLOR[activePolicyOp] || 'var(--text-muted)';
                return (
                  <div>
                    {/* Header bar */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                      <div>
                        <div style={{ fontWeight:700, color:'var(--text-primary)' }}>Provisioning Policies</div>
                        <div style={{ color:'var(--text-muted)', marginTop:2 }}>
                          Configure field mappings for each provisioning operation — just like SailPoint IIQ connector policies.
                          {conn && <span style={{ color:'#06b6d4' }}> Connector: {conn.name}</span>}
                        </div>
                      </div>
                    </div>

                    {appPoliciesLoading ? (
                      <div style={{ color:'var(--text-muted)', textAlign:'center', padding:48 }}>Loading policies…</div>
                    ) : appPolicies.length === 0 ? (
                      <div style={{ color:'var(--text-secondary)', textAlign:'center', padding:48 }}>
                        No policies found. Link a connector to this application to configure provisioning policies.
                      </div>
                    ) : (
                      <div style={{ display:'grid', gridTemplateColumns:'180px 1fr', gap:20, alignItems:'start' }}>

                        {/* Operation sidebar */}
                        <div style={{ background:'var(--bg-secondary)', border:'1px solid #1e2a3a', borderRadius:8, overflow:'hidden' }}>
                          <div style={{ padding:'8px 12px', borderBottom:'1px solid #1e2a3a', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' }}>Operations</div>
                          {appPolicies.map(p => {
                            const c = OP_COLOR[p.operation] || 'var(--text-muted)';
                            const active = activePolicyOp === p.operation;
                            return (
                              <div key={p.operation}
                                onClick={() => switchAppPolicyOp(p.operation)}
                                style={{ padding:'10px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:8,
                                         background: active ? `${c}18` : 'transparent',
                                         borderLeft: active ? `3px solid ${c}` : '3px solid transparent' }}>
                                <span style={{ fontWeight: active ? 700 : 400, color: active ? c : 'var(--text-secondary)' }}>{p.operation}</span>
                                {!p.is_default && <span style={{ width:6, height:6, borderRadius:'50%', background:c, marginLeft:'auto' }} title="Customized" />}
                              </div>
                            );
                          })}
                        </div>

                        {/* Policy field editor */}
                        {currentPolicy && (
                          <div>
                            {/* Operation header */}
                            <div style={{ padding:'10px 16px', background:`${col}12`, border:`1px solid ${col}40`, borderRadius:'8px 8px 0 0', display:'flex', alignItems:'center', gap:10 }}>
                              <span style={{ color:col, fontWeight:700 }}>{activePolicyOp}</span>
                              <span style={{ color:'var(--text-secondary)' }}>Policy</span>
                              {currentPolicy.is_default && <span style={{ color:'var(--text-muted)', background:'var(--bg-tertiary)', padding:'2px 8px', borderRadius:4, marginLeft:'auto' }}>default template</span>}
                              {policyDirty && <span style={{ color:'#f59e0b', marginLeft:'auto' }}>● unsaved changes</span>}
                            </div>

                            {/* Fields */}
                            <div style={{ border:`1px solid ${col}40`, borderTop:'none', borderRadius:'0 0 8px 8px', padding:16 }}>
                              {policyFields.length === 0 && (
                                <div style={{ color:'var(--text-muted)', textAlign:'center', padding:'12px 0' }}>
                                  {activePolicyOp === 'Delete' ? 'Delete operations require no field mappings.' : 'No fields configured. Add fields below.'}
                                </div>
                              )}

                              {policyFields.map((field, i) => (
                                <div key={i} style={{ background:'var(--bg-primary)', border:'1px solid #1e2a3a', borderRadius:6, padding:'10px 12px', marginBottom:8, display:'grid', gridTemplateColumns:'1fr 130px 1fr 90px auto', gap:8, alignItems:'center' }}>
                                  <input
                                    value={field.name || ''}
                                    placeholder="Field name (e.g. userName)"
                                    onChange={e => { const f=[...policyFields]; f[i]={...f[i],name:e.target.value}; setPolicyFields(f); setPolicyDirty(true); }}
                                    style={{ background:'transparent', border:'none', borderBottom:'1px solid #2a3545', color:'var(--text-secondary)', fontFamily:'monospace', fontWeight:600, outline:'none', padding:'2px 0' }}
                                  />
                                  <select
                                    value={field.source || 'identity'}
                                    onChange={e => { const f=[...policyFields]; f[i]={...f[i],source:e.target.value,value:'',rule_script:'',generator:''}; setPolicyFields(f); setPolicyDirty(true); }}
                                    style={{ background:'var(--bg-tertiary)', border:'1px solid #2a3545', borderRadius:4, color:'var(--text-secondary)', padding:'5px 6px' }}>
                                    <option value="identity">Identity Attr</option>
                                    <option value="static">Static Value</option>
                                    <option value="rule">Rule (JS)</option>
                                    <option value="generator">Generator</option>
                                  </select>
                                  {field.source === 'identity' && (
                                    <select value={field.value||''} onChange={e=>{const f=[...policyFields];f[i]={...f[i],value:e.target.value};setPolicyFields(f);setPolicyDirty(true);}}
                                      style={{ background:'var(--bg-tertiary)', border:'1px solid #2a3545', borderRadius:4, color:'var(--text-secondary)', padding:'5px 6px' }}>
                                      <option value="">— identity attribute —</option>
                                      {['username','email','first_name','last_name','display_name','title','department','phone','employee_id','external_id'].map(a=><option key={a} value={a}>{a}</option>)}
                                    </select>
                                  )}
                                  {field.source === 'static' && (
                                    <input value={field.value||''} placeholder="Static value"
                                      onChange={e=>{const f=[...policyFields];f[i]={...f[i],value:e.target.value};setPolicyFields(f);setPolicyDirty(true);}}
                                      style={{ background:'var(--bg-tertiary)', border:'1px solid #2a3545', borderRadius:4, color:'var(--text-secondary)', padding:'5px 8px' }}/>
                                  )}
                                  {field.source === 'generator' && (
                                    <select value={field.generator||''} onChange={e=>{const f=[...policyFields];f[i]={...f[i],generator:e.target.value};setPolicyFields(f);setPolicyDirty(true);}}
                                      style={{ background:'var(--bg-tertiary)', border:'1px solid #2a3545', borderRadius:4, color:'var(--text-secondary)', padding:'5px 6px' }}>
                                      <option value="">— generator type —</option>
                                      {['email','username','display_name','first_name','last_name','uuid'].map(g=><option key={g} value={g}>{g}</option>)}
                                    </select>
                                  )}
                                  {field.source === 'rule' && (
                                    <textarea value={field.rule_script||'result = identity.email;'} rows={2}
                                      onChange={e=>{const f=[...policyFields];f[i]={...f[i],rule_script:e.target.value};setPolicyFields(f);setPolicyDirty(true);}}
                                      style={{ background:'var(--bg-tertiary)', border:'1px solid #2a3545', borderRadius:4, color:'#8b5cf6', padding:'4px 6px', fontFamily:'monospace', resize:'vertical' }}/>
                                  )}
                                  <label style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
                                    <input type="checkbox" checked={!!field.required}
                                      onChange={e=>{const f=[...policyFields];f[i]={...f[i],required:e.target.checked};setPolicyFields(f);setPolicyDirty(true);}}
                                      style={{ accentColor:'#ef4444' }}/>
                                    <span style={{ color:'var(--text-secondary)', whiteSpace:'nowrap' }}>Required</span>
                                  </label>
                                  <button onClick={()=>{setPolicyFields(f=>f.filter((_,j)=>j!==i));setPolicyDirty(true);}}
                                    style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-secondary)', lineHeight:1, padding:'0 4px' }}>×</button>
                                </div>
                              ))}

                              <button
                                onClick={()=>{setPolicyFields(f=>[...f,{name:'',source:'identity',value:'',required:false}]);setPolicyDirty(true);}}
                                style={{ background:'transparent', border:'1px dashed #2a3545', borderRadius:6, color:'var(--text-muted)', padding:'7px 14px', cursor:'pointer', marginTop:4, display:'flex', alignItems:'center', gap:6 }}>
                                + Add Field
                              </button>

                              {/* Action bar — Reset + Save only */}
                              <div style={{ display:'flex', gap:8, marginTop:16, paddingTop:14, borderTop:'1px solid #1e2a3a', alignItems:'center' }}>
                                <button onClick={()=>resetAppPolicy(connectorId)}
                                  style={{ background:'transparent', border:'1px solid #374151', borderRadius:6, color:'var(--text-muted)', padding:'6px 12px', cursor:'pointer' }}>
                                  ↺ Reset to Defaults
                                </button>
                                <button onClick={()=>saveAppPolicy(connectorId)} disabled={!policyDirty || policySaving}
                                  style={{ background: policyDirty ? 'rgba(6,182,212,0.1)' : 'transparent',
                                           border:`1px solid ${policyDirty ? '#06b6d4' : 'var(--text-secondary)'}`,
                                           borderRadius:6, color: policyDirty ? '#06b6d4' : 'var(--text-muted)', padding:'6px 20px', cursor: policyDirty ? 'pointer' : 'default', fontWeight:600, marginLeft:'auto' }}>
                                  {policySaving ? 'Saving…' : 'Save Policy'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
