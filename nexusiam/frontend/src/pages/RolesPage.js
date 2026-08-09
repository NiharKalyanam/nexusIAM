import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Shield, Briefcase, Monitor, Star, Trash2, Users, X, Search, ChevronRight } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

const ROLE_TYPES = [
  { key: 'business',   label: 'Business Role',  icon: Briefcase, color: '#06b6d4', bg: 'rgba(6,182,212,0.1)',   badge: 'badge-info',    desc: 'Job function or business responsibility. Can include IT Roles.' },
  { key: 'it',         label: 'IT Role',         icon: Monitor,   color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', badge: 'badge-purple',  desc: 'Technical access role mapping to system entitlements.' },
  { key: 'birthright', label: 'Birthright Role', icon: Star,      color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', badge: 'badge-warning', desc: 'Auto-assigned to all users. Can include IT Roles.' },
];
const riskColors = ['','#10b981','#84cc16','#f59e0b','#f97316','#ef4444'];

function RoleDetailModal({ role, onClose, onSaved, allRoles }) {
  const [tab, setTab]                     = useState('details');
  const [form, setForm]                   = useState({ ...role });
  const [entitlements, setEntitlements]   = useState([]);
  const [allEnts, setAllEnts]             = useState([]);
  const [apps, setApps]                   = useState([]);
  const [selectedApp, setSelectedApp]     = useState('');
  const [selectedEntType, setSelectedEntType] = useState('');
  const [entTypes, setEntTypes]           = useState([]);
  const [appEnts, setAppEnts]             = useState([]);
  const [inheritedRoles, setInherited]    = useState([]);
  const [entSearch, setEntSearch]         = useState('');
  const [roleSearch, setRoleSearch]       = useState('');
  const [users, setUsers]                 = useState([]);
  const [saving, setSaving]               = useState(false);
  const rt = ROLE_TYPES.find(r => r.key === role.type) || ROLE_TYPES[0];

  useEffect(() => {
    API.get(`/roles/${role.id}/entitlements`).then(r => setEntitlements(r.data||[])).catch(()=>{});
    API.get(`/roles/${role.id}/inherited-roles`).then(r => setInherited(r.data||[])).catch(()=>{});
    API.get('/applications').then(r => setApps(r.data?.data||r.data||[])).catch(()=>{});
    API.get('/users?limit=200').then(r => setUsers(r.data?.data||[])).catch(()=>{});
  }, [role.id]);

  useEffect(() => {
    if (!selectedApp) { setAppEnts([]); setEntTypes([]); setSelectedEntType(''); return; }
    // Fetch all entitlements for app to derive types
    API.get(`/entitlements?application_id=${selectedApp}&limit=500`)
      .then(r => {
        const ents = r.data?.data||r.data||[];
        setAppEnts(ents);
        // Extract unique types
        const types = [...new Set(ents.map(e=>e.type||e.attribute).filter(Boolean))].sort();
        setEntTypes(types);
        setSelectedEntType('');
      })
      .catch(()=>{});
  }, [selectedApp]);

  const saveDetails = async () => {
    setSaving(true);
    try {
      await API.put(`/roles/${role.id}`, form);
      toast.success('Role updated'); onSaved();
    } catch(err) { toast.error(err.response?.data?.error||'Failed'); }
    finally { setSaving(false); }
  };

  const addEnt = async (id) => {
    try {
      await API.post(`/roles/${role.id}/entitlements`, { entitlement_id: id });
      const r = await API.get(`/roles/${role.id}/entitlements`);
      setEntitlements(r.data||[]); toast.success('Entitlement added');
    } catch { toast.error('Failed'); }
  };

  const removeEnt = async (id) => {
    try {
      await API.delete(`/roles/${role.id}/entitlements/${id}`);
      setEntitlements(e => e.filter(x => x.id !== id)); toast.success('Removed');
    } catch { toast.error('Failed'); }
  };

  const addInherited = async (childId) => {
    try {
      await API.post(`/roles/${role.id}/inherited-roles`, { child_role_id: childId });
      const r = await API.get(`/roles/${role.id}/inherited-roles`);
      setInherited(r.data||[]); toast.success('IT Role added');
    } catch { toast.error('Failed'); }
  };

  const removeInherited = async (childId) => {
    try {
      await API.delete(`/roles/${role.id}/inherited-roles/${childId}`);
      setInherited(i => i.filter(x => x.id !== childId)); toast.success('Removed');
    } catch { toast.error('Failed'); }
  };

  const assignedEntIds = new Set(entitlements.map(e => e.id));
  const assignedRoleIds = new Set(inheritedRoles.map(r => r.id));

  const availableEnts = appEnts.filter(e =>
    !assignedEntIds.has(e.id) &&
    (!selectedEntType || e.type===selectedEntType || e.attribute===selectedEntType) &&
    (!entSearch || e.name?.toLowerCase().includes(entSearch.toLowerCase()) || e.display_name?.toLowerCase().includes(entSearch.toLowerCase()))
  );

  // Only IT roles can be inherited by Business/Birthright
  const availableItRoles = allRoles.filter(r =>
    r.type === 'it' && r.id !== role.id && !assignedRoleIds.has(r.id) &&
    r.name?.toLowerCase().includes(roleSearch.toLowerCase())
  );

  const isItRole = role.type === 'it';
  const canInherit = role.type === 'business' || role.type === 'birthright';

  const TABS = [
    { key: 'details', label: 'Details' },
    ...(isItRole ? [{ key: 'entitlements', label: `Entitlements (${entitlements.length})` }] : []),
    ...(canInherit ? [{ key: 'it-roles', label: `IT Roles (${inheritedRoles.length})` }] : []),
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 700, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: rt.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <rt.icon size={18} color={rt.color} />
            </div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{role.name}</div>
              <span className={`badge ${rt.badge}`}>{rt.label}</span>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={14}/></button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 24px' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '10px 16px', background: 'none', border: 'none',
              borderBottom: `2px solid ${tab === t.key ? rt.color : 'transparent'}`,
              color: tab === t.key ? rt.color : 'var(--text-muted)',
              cursor: 'pointer', fontWeight: tab === t.key ? 600 : 400, marginBottom: -1
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {tab === 'details' && (
            <div>
              <div className="form-group">
                <label>Role Name</label>
                <input value={form.name||''} onChange={e => setForm({...form, name: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={form.description||''} onChange={e => setForm({...form, description: e.target.value})} rows={3} />
              </div>
              <div className="form-group">
                <label>Role Type</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ROLE_TYPES.map(rt2 => (
                    <button key={rt2.key} type="button" onClick={() => setForm({...form, type: rt2.key})}
                      style={{ padding: '6px 14px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                        border: `2px solid ${form.type === rt2.key ? rt2.color : 'var(--border-bright)'}`,
                        background: form.type === rt2.key ? rt2.bg : 'var(--bg-tertiary)',
                        color: form.type === rt2.key ? rt2.color : 'var(--text-secondary)' }}>
                      <rt2.icon size={13}/>{rt2.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Owner</label>
                <select value={form.owner_id||''} onChange={e => setForm({...form, owner_id: e.target.value||null})}>
                  <option value="">-- No Owner --</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.username})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Risk Level</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {[1,2,3,4,5].map(n => (
                    <button key={n} type="button" onClick={() => setForm({...form, risk_level: n})}
                      style={{ width: 38, height: 38, borderRadius: 8, cursor: 'pointer', fontWeight: 700,
                        border: `2px solid ${form.risk_level===n ? riskColors[n] : 'var(--border-bright)'}`,
                        background: form.risk_level===n ? `${riskColors[n]}20` : 'var(--bg-tertiary)',
                        color: form.risk_level===n ? riskColors[n] : 'var(--text-muted)' }}>{n}</button>
                  ))}
                  <span style={{ color: 'var(--text-muted)' }}>
                    {['','Low','Medium-Low','Medium','Medium-High','High'][form.risk_level||1]}
                  </span>
                </div>
              </div>
              <button className="btn btn-primary" onClick={saveDetails} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}

          {tab === 'entitlements' && (
            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                Entitlements granted when this IT Role is assigned to a user.
              </div>
              {entitlements.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Assigned ({entitlements.length})
                  </div>
                  {entitlements.map(e => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, marginBottom: 6 }}>
                      <div>
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{e.display_name||e.name}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{e.application_name} · {e.type}</div>
                      </div>
                      <button className="btn btn-danger btn-sm" onClick={() => removeEnt(e.id)}><X size={12}/></button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Add Entitlements
              </div>
              <div className="form-group">
                <label>1. Select Application</label>
                <select value={selectedApp} onChange={e=>{setSelectedApp(e.target.value);setEntSearch('');}}>
                  <option value="">-- Select Application --</option>
                  {apps.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {selectedApp && entTypes.length > 0 && (
              <div className="form-group">
                <label>2. Select Entitlement Type</label>
                <select value={selectedEntType} onChange={e=>{setSelectedEntType(e.target.value);setEntSearch('');}}>
                  <option value="">All Types ({appEnts.length})</option>
                  {entTypes.map(t=>(
                    <option key={t} value={t}>{t} ({appEnts.filter(e=>e.type===t||e.attribute===t).length})</option>
                  ))}
                </select>
              </div>
              )}
              {selectedApp && (
              <div className="form-group">
                <label>{entTypes.length > 0 ? '3.' : '2.'} Search Entitlements</label>
                <div style={{ position:'relative' }}>
                  <Search size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
                  <input value={entSearch} onChange={e=>setEntSearch(e.target.value)} placeholder="Search entitlements..." style={{ paddingLeft:32 }}/>
                </div>
              </div>
              )}
              {!selectedApp ? (
                <div style={{ padding:20, textAlign:'center', color:'var(--text-muted)', border:'1px solid var(--border)', borderRadius:8 }}>
                  Select an application above to browse its entitlements
                </div>
              ) : (
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                {availableEnts.length === 0
                  ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                      {entSearch ? 'No matching entitlements' : appEnts.length===0 ? 'No entitlements for this application' : 'All entitlements already assigned'}
                    </div>
                  : availableEnts.map(e => (
                    <div key={e.id} onClick={() => addEnt(e.id)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onMouseEnter={el => el.currentTarget.style.background='var(--hover-bg)'}
                      onMouseLeave={el => el.currentTarget.style.background=''}>
                      <div>
                        <div style={{ color: 'var(--text-primary)' }}>{e.display_name||e.name}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{e.application_name} · {e.type}</div>
                      </div>
                      <Plus size={14} color="var(--accent)" />
                    </div>
                  ))
                }
              </div>
              )}
            </div>
          )}

          {tab === 'it-roles' && (
            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                IT Roles included in this {rt.label}. Users assigned this role will also receive all entitlements from the included IT Roles.
              </div>
              {inheritedRoles.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Included IT Roles ({inheritedRoles.length})
                  </div>
                  {inheritedRoles.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(139,92,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Monitor size={15} color="#8b5cf6" />
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{r.name}</div>
                          <div style={{ color: 'var(--text-muted)' }}>{r.description||'IT Role'}</div>
                        </div>
                      </div>
                      <button className="btn btn-danger btn-sm" onClick={() => removeInherited(r.id)}><X size={12}/></button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Add IT Roles
              </div>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input value={roleSearch} onChange={e => setRoleSearch(e.target.value)} placeholder="Search IT roles..." style={{ paddingLeft: 32 }} />
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                {availableItRoles.length === 0
                  ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                      {roleSearch ? 'No matching IT roles' : allRoles.filter(r=>r.type==='it').length === 0 ? 'No IT Roles created yet' : 'All IT Roles already included'}
                    </div>
                  : availableItRoles.map(r => (
                    <div key={r.id} onClick={() => addInherited(r.id)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onMouseEnter={el => el.currentTarget.style.background='var(--hover-bg)'}
                      onMouseLeave={el => el.currentTarget.style.background=''}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Monitor size={15} color="#8b5cf6" />
                        <div>
                          <div style={{ color: 'var(--text-primary)' }}>{r.name}</div>
                          <div style={{ color: 'var(--text-muted)' }}>{r.description||'IT Role'} · R{r.risk_level}</div>
                        </div>
                      </div>
                      <Plus size={14} color="var(--accent)" />
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateRoleModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', description: '', type: 'business', risk_level: 1, owner_id: '' });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    API.get('/users?limit=200').then(r => setUsers(r.data?.data||[])).catch(()=>{});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await API.post('/roles', { ...form, owner_id: form.owner_id||null });
      toast.success('Role created'); onSaved(); onClose();
    } catch(err) { toast.error(err.response?.data?.error||'Failed'); }
    finally { setLoading(false); }
  };

  const rt = ROLE_TYPES.find(r => r.key === form.type)||ROLE_TYPES[0];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Create New Role</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={14}/></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Role Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {ROLE_TYPES.map(rt2 => (
                  <div key={rt2.key} onClick={() => setForm({...form, type: rt2.key})}
                    style={{ border: `2px solid ${form.type===rt2.key ? rt2.color : 'var(--border-bright)'}`, borderRadius: 10, padding: 12, cursor: 'pointer',
                      background: form.type===rt2.key ? rt2.bg : 'var(--bg-tertiary)', textAlign: 'center', transition: 'all 0.15s' }}>
                    <rt2.icon size={20} color={form.type===rt2.key ? rt2.color : 'var(--text-muted)'} style={{ margin: '0 auto 6px', display: 'block' }} />
                    <div style={{ fontWeight: 600, color: form.type===rt2.key ? rt2.color : 'var(--text-secondary)' }}>{rt2.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>{rt.desc}</div>
            </div>
            <div className="form-group">
              <label>Role Name *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Finance Manager" required />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} placeholder="Describe the purpose..." />
            </div>
            <div className="form-group">
              <label>Owner</label>
              <select value={form.owner_id} onChange={e => setForm({...form, owner_id: e.target.value})}>
                <option value="">-- No Owner --</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.username})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Risk Level</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" onClick={() => setForm({...form, risk_level: n})}
                    style={{ width: 38, height: 38, borderRadius: 8, cursor: 'pointer', fontWeight: 700,
                      border: `2px solid ${form.risk_level===n ? riskColors[n] : 'var(--border-bright)'}`,
                      background: form.risk_level===n ? `${riskColors[n]}20` : 'var(--bg-tertiary)',
                      color: form.risk_level===n ? riskColors[n] : 'var(--text-muted)' }}>{n}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create Role'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RolesPage() {
  const [roles, setRoles]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [activeType, setActiveType] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [detailRole, setDetailRole] = useState(null);
  const [search, setSearch]         = useState('');

  const fetchRoles = async () => {
    setLoading(true);
    try { const r = await API.get('/roles'); setRoles(r.data||[]); }
    catch { toast.error('Failed to load roles'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchRoles(); }, []);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this role?')) return;
    try { await API.delete(`/roles/${id}`); toast.success('Role deleted'); fetchRoles(); }
    catch { toast.error('Failed to delete role'); }
  };

  const filtered = roles.filter(r => {
    const matchType = activeType === 'all' || r.type === activeType;
    const matchSearch = !search || r.name?.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const counts = { all: roles.length };
  ROLE_TYPES.forEach(rt => { counts[rt.key] = roles.filter(r => r.type === rt.key).length; });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Roles</div>
          <div className="page-subtitle">{roles.length} roles — Business, IT, and Birthright</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={fetchRoles}><RefreshCw size={14}/></button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14}/> New Role</button>
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: 'var(--text-muted)', display: 'flex', gap: 24 }}>
        <span><Monitor size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} color="#8b5cf6"/>IT Roles contain entitlements</span>
        <ChevronRight size={13} style={{ verticalAlign: 'middle' }} />
        <span><Briefcase size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} color="#06b6d4"/>Business Roles include IT Roles</span>
        <ChevronRight size={13} style={{ verticalAlign: 'middle' }} />
        <span><Star size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} color="#f59e0b"/>Birthright Roles include IT Roles + auto-assign</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search roles..." style={{ paddingLeft: 32 }} />
        </div>
        <button onClick={() => setActiveType('all')} className={`btn btn-sm ${activeType==='all' ? 'btn-primary' : 'btn-secondary'}`}>All ({counts.all})</button>
        {ROLE_TYPES.map(rt => (
          <button key={rt.key} onClick={() => setActiveType(rt.key)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 8, fontWeight: 500, cursor: 'pointer',
              border: `1px solid ${activeType===rt.key ? rt.color : 'var(--border-bright)'}`,
              background: activeType===rt.key ? rt.bg : 'var(--bg-tertiary)',
              color: activeType===rt.key ? rt.color : 'var(--text-secondary)' }}>
            <rt.icon size={13}/>{rt.label} ({counts[rt.key]})
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Shield size={40} style={{ margin: '0 auto 12px', opacity: 0.3, display: 'block' }} />
          <div style={{ color: 'var(--text-muted)' }}>No roles found</div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setShowCreate(true)}><Plus size={14}/> Create First Role</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 16 }}>
          {filtered.map(r => {
            const rt = ROLE_TYPES.find(x => x.key===r.type)||ROLE_TYPES[0];
            return (
              <div key={r.id} className="card" style={{ cursor: 'pointer' }}
                onClick={() => setDetailRole(r)}
                onMouseEnter={e => e.currentTarget.style.outline=`2px solid ${rt.color}40`}
                onMouseLeave={e => e.currentTarget.style.outline=''}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: rt.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <rt.icon size={20} color={rt.color}/>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge ${rt.badge}`}>{rt.label}</span>
                    <span style={{ color: riskColors[r.risk_level], fontWeight: 700 }}>R{r.risk_level}</span>
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{r.name}</div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>{r.description||'No description'}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 12, color: 'var(--text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Users size={12}/>{r.user_count||0}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Shield size={12}/>{r.entitlement_count||0}</span>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={(e) => handleDelete(r.id, e)}><Trash2 size={12}/></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <CreateRoleModal onClose={() => setShowCreate(false)} onSaved={fetchRoles} />}
      {detailRole && <RoleDetailModal role={detailRole} allRoles={roles} onClose={() => setDetailRole(null)} onSaved={() => { fetchRoles(); setDetailRole(null); }} />}
    </div>
  );
}
