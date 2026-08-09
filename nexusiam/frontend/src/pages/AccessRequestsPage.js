import React, { useState, useEffect } from 'react';
import { Plus, Search, CheckCircle, XCircle, Clock, RefreshCw,
         Shield, ChevronRight, X, Trash2, Filter, Users, Key } from 'lucide-react';
import API from '../utils/api';
import Pagination from '../components/Pagination';
import toast from 'react-hot-toast';

const statusBadge = { approved:'success', rejected:'danger', pending:'warning', cancelled:'gray', expired:'gray' };

// ── Step Indicator ─────────────────────────────────────────────────────────────
function Steps({ current }) {
  const steps = [
    { n:1, label:'Select Users' },
    { n:2, label:'Select Access' },
    { n:3, label:'Review & Submit' },
  ];
  return (
    <div style={{ display:'flex', alignItems:'center', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 28px', marginBottom:24 }}>
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <div style={{ display:'flex', alignItems:'center', gap:10, flex:1 }}>
            <div style={{ width:34, height:34, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, flexShrink:0,
              background: current > s.n ? '#10b981' : current === s.n ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: current >= s.n ? '#fff' : 'var(--text-muted)',
              border: `2px solid ${current >= s.n ? 'transparent' : 'var(--border-bright)'}` }}>
              {current > s.n ? <CheckCircle size={16}/> : s.n}
            </div>
            <span style={{ fontWeight: current===s.n ? 700 : 400, color: current>=s.n ? 'var(--text-primary)' : 'var(--text-muted)' }}>{s.label}</span>
          </div>
          {i < steps.length-1 && <div style={{ width:60, height:2, background: current > i+1 ? 'var(--accent)' : 'var(--border-bright)', flexShrink:0 }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Step 1: Select Users ───────────────────────────────────────────────────────
function Step1({ selected, setSelected, catalog }) {
  const [search, setSearch]             = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [deptFilter, setDeptFilter]     = useState('');
  const [showFilters, setShowFilters]   = useState(false);

  const filtered = (catalog.users||[]).filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.display_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q) || u.department?.toLowerCase().includes(q) || u.title?.toLowerCase().includes(q);
    const matchMgr  = !managerFilter || u.manager_id === managerFilter;
    const matchDept = !deptFilter    || u.department === deptFilter;
    return matchSearch && matchMgr && matchDept;
  });

  const toggle = (user) => {
    if (selected.find(s => s.id === user.id)) {
      setSelected(selected.filter(s => s.id !== user.id));
    } else if (selected.length >= 50) {
      toast.error('Maximum 50 users');
    } else {
      setSelected([...selected, user]);
    }
  };
  const isSel = (id) => !!selected.find(s => s.id === id);
  const activeFilters = [managerFilter, deptFilter].filter(Boolean).length;

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:4 }}>Select Users</div>
        <div style={{ color:'var(--text-muted)' }}>Select up to 50 users. {selected.length > 0 && <strong style={{color:'var(--accent)'}}>{selected.length} selected</strong>}</div>
      </div>
      <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <div style={{ position:'relative', flex:1, minWidth:200 }}>
          <Search size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, email, title, department..." style={{ paddingLeft:32 }}/>
        </div>
        <button onClick={()=>setShowFilters(!showFilters)} className={`btn btn-sm ${activeFilters>0?'btn-primary':'btn-secondary'}`}>
          <Filter size={13}/> Filters {activeFilters>0?`(${activeFilters})`:''}
        </button>
        {selected.length > 0 && <button className="btn btn-secondary btn-sm" onClick={()=>setSelected([])}>Clear All</button>}
      </div>
      {showFilters && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12, padding:14, background:'var(--bg-tertiary)', borderRadius:10, border:'1px solid var(--border)' }}>
          <div className="form-group" style={{ margin:0 }}>
            <label>Manager</label>
            <select value={managerFilter} onChange={e=>setManagerFilter(e.target.value)}>
              <option value="">All Managers</option>
              {(catalog.managers||[]).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin:0 }}>
            <label>Department</label>
            <select value={deptFilter} onChange={e=>setDeptFilter(e.target.value)}>
              <option value="">All Departments</option>
              {(catalog.departments||[]).map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ gridColumn:'1/-1', textAlign:'right' }}>
            <button className="btn btn-secondary btn-sm" onClick={()=>{setManagerFilter('');setDeptFilter('');}}>Reset</button>
          </div>
        </div>
      )}
      {selected.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12, padding:10, background:'rgba(6,182,212,0.05)', border:'1px solid rgba(6,182,212,0.2)', borderRadius:8 }}>
          {selected.map(u=>(
            <span key={u.id} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', background:'rgba(6,182,212,0.1)', border:'1px solid rgba(6,182,212,0.3)', borderRadius:20, color:'var(--accent)' }}>
              {u.display_name}
              <button onClick={()=>toggle(u)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:0, display:'flex' }}><X size={11}/></button>
            </span>
          ))}
        </div>
      )}
      <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', maxHeight:400, overflowY:'auto' }}>
        {filtered.length===0
          ? <div style={{ padding:32, textAlign:'center', color:'var(--text-muted)' }}>No users match current filters</div>
          : filtered.map(u=>(
            <div key={u.id} onClick={()=>toggle(u)}
              style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 16px', borderBottom:'1px solid var(--border)', cursor:'pointer', background: isSel(u.id)?'rgba(6,182,212,0.05)':'' }}
              onMouseEnter={e=>{ if(!isSel(u.id)) e.currentTarget.style.background='var(--hover-bg)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=isSel(u.id)?'rgba(6,182,212,0.05)':''; }}>
              <div style={{ width:22, height:22, borderRadius:6, border:`2px solid ${isSel(u.id)?'var(--accent)':'var(--border-bright)'}`, background:isSel(u.id)?'var(--accent)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                {isSel(u.id)&&<CheckCircle size={13} color="#fff"/>}
              </div>
              <div style={{ width:34, height:34, borderRadius:'50%', background:'linear-gradient(135deg,#06b6d4,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:'#fff', flexShrink:0 }}>
                {(u.display_name||u.username)?.[0]?.toUpperCase()}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:500, color:'var(--text-primary)' }}>{u.display_name}</div>
                <div style={{ color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {u.email}{u.department?` · ${u.department}`:''}{u.title?` · ${u.title}`:''}{u.manager_name?` · Mgr: ${u.manager_name}`:''}
                </div>
              </div>
              <span className={`badge badge-${u.status==='active'?'success':'gray'}`}>{u.status}</span>
            </div>
          ))
        }
      </div>
      <div style={{ marginTop:6, color:'var(--text-muted)' }}>{filtered.length} users · {selected.length}/50 selected</div>
    </div>
  );
}

// ── Step 2: Select Access ──────────────────────────────────────────────────────
function Step2({ selectedAccess, setSelectedAccess, catalog }) {
  const [search, setSearch]           = useState('');
  const [typeFilter, setTypeFilter]   = useState('all');
  const [appFilter, setAppFilter]     = useState('');
  const [roleTypeFilter, setRoleTypeFilter] = useState('');
  const [requestableOnly, setRequestableOnly] = useState(true);

  const allItems = [
    ...(catalog.roles||[]).map(r=>({ ...r, _type:'role', _color:r.type==='it'?'#8b5cf6':r.type==='birthright'?'#f59e0b':'#06b6d4', _appName:`${r.type} role` })),
    ...(catalog.entitlements||[]).map(e=>({ ...e, _type:'entitlement', _color:'#10b981', _appName:e.application_name||'Entitlement' })),
  ];

  const apps = [...new Set((catalog.entitlements||[]).map(e=>e.application_name).filter(Boolean))].sort();
  const entitlementAttrs = [...new Set((catalog.entitlements||[]).map(e=>e.type).filter(Boolean))].sort();
  const [entitlementAttrFilter, setEntitlementAttrFilter] = useState('');
  const roleTypes = [...new Set((catalog.roles||[]).map(r=>r.type).filter(Boolean))];

  const filtered = allItems.filter(item=>{
    const q = search.toLowerCase();
    const matchSearch = !q || item.name?.toLowerCase().includes(q) || item.display_name?.toLowerCase().includes(q) || item._appName?.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q);
    const matchType = typeFilter==='all' || item._type===typeFilter;
    const matchApp  = !appFilter || item.application_name===appFilter;
    const matchRT   = !roleTypeFilter || item.type===roleTypeFilter;
    const matchEntAttr = item._type !== 'entitlement' || !entitlementAttrFilter || item.type === entitlementAttrFilter;
    const matchRequestable = !requestableOnly || item._type !== 'entitlement' || item.requestable !== false;
    return matchSearch && matchType && matchApp && matchRT && matchEntAttr && matchRequestable;
  });

  const isSel = (id) => !!selectedAccess.find(a=>a.id===id);
  const toggle = (item) => {
    if (isSel(item.id)) setSelectedAccess(selectedAccess.filter(a=>a.id!==item.id));
    else setSelectedAccess([...selectedAccess, { ...item, justification:'' }]);
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:4 }}>Select Access</div>
        <div style={{ color:'var(--text-muted)' }}>Choose roles or entitlements. {selectedAccess.length>0&&<strong style={{color:'var(--accent)'}}>{selectedAccess.length} selected</strong>}</div>
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <div style={{ position:'relative', flex:1, minWidth:200 }}>
          <Search size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search roles or entitlements..." style={{ paddingLeft:32 }}/>
        </div>
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{ width:'auto', minWidth:130 }}>
          <option value="all">All Types</option>
          <option value="role">Roles Only</option>
          <option value="entitlement">Entitlements Only</option>
        </select>
        {typeFilter!=='entitlement' && roleTypes.length>0 && (
          <select value={roleTypeFilter} onChange={e=>setRoleTypeFilter(e.target.value)} style={{ width:'auto', minWidth:130 }}>
            <option value="">All Role Types</option>
            {roleTypes.map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
          </select>
        )}
        {typeFilter!=='role' && apps.length>0 && (
          <select value={appFilter} onChange={e=>setAppFilter(e.target.value)} style={{ width:'auto', minWidth:150 }}>
            <option value="">All Applications</option>
            {apps.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {typeFilter!=='role' && entitlementAttrs.length>0 && (
          <select value={entitlementAttrFilter} onChange={e=>setEntitlementAttrFilter(e.target.value)} style={{ width:'auto', minWidth:160 }}>
            <option value="">All Entitlement Attributes</option>
            {entitlementAttrs.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {typeFilter!=='role' && (
          <label style={{ display:'inline-flex', alignItems:'center', gap:6, color:'var(--text-secondary)', padding:'0 8px', textTransform:'none', letterSpacing:'normal', marginBottom:0 }}>
            <input type="checkbox" checked={requestableOnly} onChange={e=>setRequestableOnly(e.target.checked)} style={{ width:'auto' }} />
            Requestable only
          </label>
        )}
      </div>
      {selectedAccess.length>0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12, padding:10, background:'var(--bg-tertiary)', borderRadius:8 }}>
          {selectedAccess.map(a=>(
            <span key={a.id} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', background:`${a._color}15`, border:`1px solid ${a._color}40`, borderRadius:20, color:a._color }}>
              {a.display_name||a.name}
              <button onClick={()=>toggle(a)} style={{ background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',padding:0,display:'flex' }}><X size={11}/></button>
            </span>
          ))}
        </div>
      )}
      <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', maxHeight:400, overflowY:'auto' }}>
        {filtered.length===0
          ? <div style={{ padding:32, textAlign:'center', color:'var(--text-muted)' }}>No items match filters</div>
          : filtered.map(item=>(
            <div key={item.id} onClick={()=>toggle(item)}
              style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 16px', borderBottom:'1px solid var(--border)', cursor:'pointer', background:isSel(item.id)?`${item._color}08`:'' }}
              onMouseEnter={e=>{ if(!isSel(item.id)) e.currentTarget.style.background='var(--hover-bg)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=isSel(item.id)?`${item._color}08`:''; }}>
              <div style={{ width:22, height:22, borderRadius:6, border:`2px solid ${isSel(item.id)?item._color:'var(--border-bright)'}`, background:isSel(item.id)?item._color:'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                {isSel(item.id)&&<CheckCircle size={13} color="#fff"/>}
              </div>
              <div style={{ width:36, height:36, borderRadius:9, background:`${item._color}20`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                {item._type==='role'?<Shield size={16} color={item._color}/>:<Key size={16} color={item._color}/>}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontWeight:500, color:'var(--text-primary)' }}>{item.display_name||item.name}</span>
                  <span style={{ padding:'1px 7px', borderRadius:10, background:`${item._color}15`, color:item._color, fontWeight:600 }}>{item._appName}</span>
                </div>
                {item.description && <div style={{ color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.description}</div>}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── Step 3: Review & Submit ────────────────────────────────────────────────────
function Step3({ selectedUsers, selectedAccess, setSelectedAccess, onSubmit, submitting }) {
  const [globalJust, setGlobalJust] = useState('');
  const [applyGlobal, setApplyGlobal] = useState(false);
  const [priority, setPriority]     = useState('medium');
  const [duration, setDuration]     = useState('');

  const updateJust = (id, val) => setSelectedAccess(p=>p.map(a=>a.id===id?{...a,justification:val}:a));
  useEffect(()=>{ if(applyGlobal&&globalJust) setSelectedAccess(p=>p.map(a=>({...a,justification:globalJust}))); },[globalJust,applyGlobal]);

  const canSubmit = selectedAccess.length>0 && selectedAccess.every(a=>a.justification?.trim());
  const total = selectedUsers.length * selectedAccess.length;

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:4 }}>Review & Submit</div>
        <div style={{ color:'var(--text-muted)' }}>Submitting <strong>{total}</strong> request{total!==1?'s':''} — <strong>{selectedAccess.length}</strong> item{selectedAccess.length!==1?'s':''} for <strong>{selectedUsers.length}</strong> user{selectedUsers.length!==1?'s':''}.</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:12, marginBottom:20 }}>
        <div className="card" style={{ padding:14 }}>
          <div style={{ color:'var(--text-muted)', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.06em' }}>Users ({selectedUsers.length})</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
            {selectedUsers.slice(0,6).map(u=><span key={u.id} style={{ padding:'2px 8px', background:'rgba(6,182,212,0.1)', color:'var(--accent)', borderRadius:10 }}>{u.display_name}</span>)}
            {selectedUsers.length>6&&<span style={{ color:'var(--text-muted)' }}>+{selectedUsers.length-6} more</span>}
          </div>
        </div>
        <div className="card" style={{ padding:14 }}>
          <div style={{ color:'var(--text-muted)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.06em' }}>Priority & Duration</div>
          <div style={{ display:'flex', gap:10 }}>
            <select value={priority} onChange={e=>setPriority(e.target.value)} style={{ flex:1 }}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <input type="number" placeholder="Days (opt)" value={duration} onChange={e=>setDuration(e.target.value)} style={{ flex:1 }} min={1}/>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginBottom:16, padding:16 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div style={{ fontWeight:600, color:'var(--text-primary)' }}>Global Business Justification</div>
          <label style={{ display:'flex', alignItems:'center', gap:7, color:'var(--text-secondary)', margin:0, cursor:'pointer' }}>
            <input type="checkbox" checked={applyGlobal} onChange={e=>setApplyGlobal(e.target.checked)} style={{ width:'auto' }}/>
            Apply to all items
          </label>
        </div>
        <textarea value={globalJust} onChange={e=>setGlobalJust(e.target.value)} rows={2} placeholder="Common justification for all access items..."/>
      </div>
      <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
        Access Items
        {!canSubmit && selectedAccess.some(a=>!a.justification?.trim()) && <span style={{ color:'var(--danger)', fontWeight:400 }}>⚠ All items require justification</span>}
      </div>
      {selectedAccess.map(a=>(
        <div key={a.id} className="card" style={{ marginBottom:10, padding:14, border:`1px solid ${a.justification?.trim()?'var(--border)':'rgba(239,68,68,0.3)'}` }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:32, height:32, borderRadius:8, background:`${a._color}20`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                {a._type==='role'?<Shield size={15} color={a._color}/>:<Key size={15} color={a._color}/>}
              </div>
              <div>
                <div style={{ fontWeight:500, color:'var(--text-primary)' }}>{a.display_name||a.name}</div>
                <div style={{ color:'var(--text-muted)' }}>{a._appName}</div>
              </div>
            </div>
            <button onClick={()=>setSelectedAccess(p=>p.filter(x=>x.id!==a.id))} className="btn btn-danger btn-sm"><Trash2 size={12}/> Remove</button>
          </div>
          <label style={{ textTransform:'none', letterSpacing:'normal', marginBottom:5, color:'var(--text-secondary)' }}>
            Business Justification *{!a.justification?.trim()&&<span style={{ color:'var(--danger)' }}> (required)</span>}
          </label>
          <textarea value={a.justification||''} onChange={e=>updateJust(a.id,e.target.value)}
            placeholder={`Why do the selected users need "${a.display_name||a.name}"?`} rows={2}/>
        </div>
      ))}
      <div style={{ display:'flex', justifyContent:'flex-end', marginTop:8 }}>
        <button className="btn btn-primary" onClick={()=>onSubmit({priority,duration_days:duration||null})}
          disabled={!canSubmit||submitting} style={{ padding:'10px 28px' }}>
          {submitting?'Submitting...':`Submit ${total} Request${total!==1?'s':''}`}
        </button>
      </div>
    </div>
  );
}

// ── Request Detail ─────────────────────────────────────────────────────────────
function RequestDetailModal({ requestId, onClose }) {
  const [req, setReq]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    API.get(`/access-requests/${requestId}`)
      .then(r=>setReq(r.data))
      .catch(()=>toast.error('Failed to load'))
      .finally(()=>setLoading(false));
  },[requestId]);

  if (loading) return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:600, padding:40, textAlign:'center' }} onClick={e=>e.stopPropagation()}>Loading...</div>
    </div>
  );
  if (!req) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:620 }} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontWeight:700, color:'var(--text-primary)' }}>{req.ticket_number}</div>
            <span className={`badge badge-${req.status==='approved'?'success':req.status==='rejected'?'danger':req.status==='pending'?'warning':'gray'}`}>{req.status}</span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={14}/></button>
        </div>
        <div className="modal-body">
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:10, marginBottom:16 }}>
            {[['Resource',req.resource_name],['Type',req.request_type?.replace('_',' ')],['Requested By',req.requester_name],['Requested For',req.target_name||req.requester_name],['Priority',req.priority],['Submitted',req.requested_at?new Date(req.requested_at).toLocaleString():'-']].map(([k,v])=>(
              <div key={k} style={{ padding:'10px 12px', background:'var(--bg-tertiary)', borderRadius:8 }}>
                <div style={{ color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>{k}</div>
                <div style={{ fontWeight:500, color:'var(--text-primary)' }}>{v||'—'}</div>
              </div>
            ))}
          </div>
          <div style={{ padding:'12px 14px', background:'var(--bg-tertiary)', borderRadius:8, marginBottom:14 }}>
            <div style={{ color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Business Justification</div>
            <div style={{ color:'var(--text-primary)', lineHeight:1.6 }}>{req.justification||'—'}</div>
          </div>
          {req.resolution_notes && (
            <div style={{ padding:'10px 14px', background:'rgba(245,158,11,0.05)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, marginBottom:12 }}>
              <div style={{ color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Resolution Notes</div>
              <div style={{ color:'var(--text-secondary)' }}>{req.resolution_notes}</div>
            </div>
          )}

          {/* Approval History */}
          {req.work_items?.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:10 }}>Approval Trail</div>
              {req.work_items.map((wi,i) => {
                const statusColor = wi.status==='approved'?'#10b981':wi.status==='rejected'?'#ef4444':wi.status==='forwarded'?'#8b5cf6':wi.status==='cancelled'?'#64748b':'#f59e0b';
                const statusIcon = wi.status==='approved'?<CheckCircle size={14} color={statusColor}/>:wi.status==='rejected'?<XCircle size={14} color={statusColor}/>:wi.status==='forwarded'?<ChevronRight size={14} color={statusColor}/>:<Clock size={14} color={statusColor}/>;
                return (
                  <div key={i} style={{ display:'flex', gap:12, padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background:`${statusColor}15`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>
                      {statusIcon}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <span style={{ fontWeight:600, color:'var(--text-primary)' }}>{wi.assignee_name||'Approver'}</span>
                        <span style={{ padding:'1px 7px', borderRadius:10, background:`${statusColor}15`, color:statusColor, fontWeight:600 }}>{wi.status}</span>
                        {wi.acted_at && <span style={{ color:'var(--text-muted)' }}>{new Date(wi.acted_at).toLocaleString()}</span>}
                        {!wi.acted_at && <span style={{ color:'#f59e0b' }}>⏳ Pending action</span>}
                      </div>
                      {wi.action_comments && (
                        <div style={{ color:'var(--text-secondary)', marginTop:4, padding:'4px 8px', background:'var(--bg-tertiary)', borderRadius:6 }}>
                          "{wi.action_comments}"
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Provisioning Results */}
          {req.status === 'approved' && (
            <div style={{ marginTop:4 }}>
              <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:10 }}>Provisioning Results</div>
              {(!req.provisioning_transactions || req.provisioning_transactions.length === 0) ? (
                <div style={{ padding:'12px 14px', background:'rgba(6,182,212,0.06)', border:'1px solid rgba(6,182,212,0.2)', borderRadius:8 }}>
                  <div style={{ fontWeight:500, color:'#06b6d4' }}>ℹ Access Granted (Internal Only)</div>
                  <div style={{ color:'var(--text-muted)', marginTop:4 }}>
                    The role was granted inside NexusIAM. No external connector is linked to this role, so no push was attempted. This is expected if the role is managed manually or if provisioning to a target system has not been configured yet.
                  </div>
                </div>
              ) : (
                <div>
                  {/* Summary bar */}
                  {(() => {
                    const total   = req.provisioning_transactions.length;
                    const success = req.provisioning_transactions.filter(t => t.status === 'successful' || t.status === 'success' || t.status === 'completed').length;
                    const failed  = req.provisioning_transactions.filter(t => t.status === 'failed').length;
                    const pending = total - success - failed;
                    return (
                      <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
                        <span style={{ padding:'3px 10px', borderRadius:12, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:600 }}>✓ {success} succeeded</span>
                        {failed > 0 && <span style={{ padding:'3px 10px', borderRadius:12, background:'rgba(239,68,68,0.12)', color:'#ef4444', fontWeight:600 }}>✗ {failed} failed</span>}
                        {pending > 0 && <span style={{ padding:'3px 10px', borderRadius:12, background:'rgba(245,158,11,0.12)', color:'#f59e0b', fontWeight:600 }}>⏳ {pending} pending</span>}
                      </div>
                    );
                  })()}
                  {/* Per-entitlement rows */}
                  {req.provisioning_transactions.map((pt, i) => {
                    const isSuccess = ['successful','success','completed'].includes(pt.status);
                    const isFailed  = pt.status === 'failed';
                    const color = isSuccess ? '#10b981' : isFailed ? '#ef4444' : '#f59e0b';
                    const icon  = isSuccess ? '✓' : isFailed ? '✗' : '⏳';
                    // Extract entitlement name from plan_payload if available
                    let entName = null;
                    try { entName = pt.plan_payload?.resource_name || pt.plan_payload?.entitlement_name || null; } catch {}
                    return (
                      <div key={i} style={{ padding:'10px 14px', background:`${color}06`, border:`1px solid ${color}25`, borderRadius:8, marginBottom:6 }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:0 }}>
                            <span style={{ fontWeight:700, color, flexShrink:0 }}>{icon}</span>
                            <div style={{ minWidth:0 }}>
                              {entName && <div style={{ fontWeight:600, color:'var(--text-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{entName}</div>}
                              <div style={{ color:'var(--text-muted)', display:'flex', gap:6, flexWrap:'wrap' }}>
                                <span>{pt.connector_name || 'Application'}</span>
                                {pt.connector_type && <span>· {pt.connector_type}</span>}
                              </div>
                            </div>
                          </div>
                          <span style={{ padding:'2px 8px', borderRadius:10, background:`${color}20`, color, fontWeight:600, border:`1px solid ${color}40`, flexShrink:0, marginLeft:8 }}>
                            {isSuccess ? 'Success' : isFailed ? 'Failed' : pt.status}
                          </span>
                        </div>
                        {pt.error_message && (
                          <div style={{ color:'#ef4444', padding:'6px 8px', background:'rgba(239,68,68,0.06)', borderRadius:6, marginTop:6 }}>
                            <strong>Error:</strong> {pt.error_message}
                          </div>
                        )}
                        {isSuccess && pt.completed_at && (
                          <div style={{ color:'var(--text-muted)', marginTop:4 }}>
                            Completed {new Date(pt.completed_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AccessRequestsPage() {
  const [view, setView]                     = useState('list');
  const [step, setStep]                     = useState(1);
  const [catalog, setCatalog]               = useState({ users:[], roles:[], applications:[], entitlements:[], managers:[], departments:[] });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedUsers, setSelectedUsers]   = useState([]);
  const [selectedAccess, setSelectedAccess] = useState([]);
  const [submitting, setSubmitting]         = useState(false);
  const [requests, setRequests]             = useState([]);
  const [loading, setLoading]               = useState(true);
  const [search, setSearch]                 = useState('');
  const [statusFilter, setStatusFilter]     = useState('all');
  const [page, setPage]                     = useState(1);
  const [limit, setLimit]                   = useState(15);
  const [total, setTotal]                   = useState(0);
  const [detailId, setDetailId]             = useState(null);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const status = statusFilter !== 'all' ? statusFilter : '';
      const r = await API.get(`/access-requests?page=${page}&limit=${limit}${status?`&status=${status}`:''}`);
      setRequests(r.data?.data||[]);
      setTotal(r.data?.total||0);
    } catch { toast.error('Failed to load requests'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchRequests(); }, [page, limit, statusFilter]); // eslint-disable-line

  const loadCatalog = async () => {
    setCatalogLoading(true);
    try { const r = await API.get('/access-requests/catalog'); setCatalog(r.data||{}); }
    catch(err) { toast.error('Failed to load catalog: '+(err.response?.data?.error||'Server error')); }
    finally { setCatalogLoading(false); }
  };

  const startNew = () => {
    setStep(1); setSelectedUsers([]); setSelectedAccess([]);
    setView('new'); loadCatalog();
  };

  const handleCancel = async (id) => {
    const reason = window.prompt('Reason for cancellation (required):');
    if (!reason) return;
    try {
      await API.post(`/access-requests/${id}/action`, { action:'cancelled', comments:reason });
      toast.success('Request cancelled');
      fetchRequests();
    } catch(err) { toast.error(err.response?.data?.error||'Failed'); }
  };

  const handleSubmit = async ({ priority, duration_days }) => {
    setSubmitting(true);
    try {
      const reqs = [];
      for (const user of selectedUsers) {
        for (const access of selectedAccess) {
          reqs.push(API.post('/access-requests', {
            request_type: access._type==='role'?'role_grant':'entitlement_grant',
            target_user_id: user.id,
            resource_id: access.id,
            resource_type: access._type,
            resource_name: access.display_name||access.name,
            justification: access.justification,
            priority,
            duration_days}));
        }
      }
      await Promise.all(reqs);
      toast.success(`${reqs.length} request${reqs.length!==1?'s':''} submitted!`);
      setView('list'); fetchRequests();
    } catch(err) { toast.error(err.response?.data?.error||'Failed to submit'); }
    finally { setSubmitting(false); }
  };

  const filtered = requests.filter(r => {
    const q = search.toLowerCase();
    return !q || r.resource_name?.toLowerCase().includes(q) || r.requester_name?.toLowerCase().includes(q) || r.target_name?.toLowerCase().includes(q);
  });

  // ── New Request Wizard ─────────────────────────────────────────────────────
  if (view==='new') return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">New Access Request</div>
          <div className="page-subtitle">Request roles or entitlements for one or more users</div>
        </div>
        <button className="btn btn-secondary" onClick={()=>setView('list')}><X size={14}/> Cancel</button>
      </div>
      <Steps current={step}/>
      {catalogLoading ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--text-muted)' }}>Loading catalog...</div>
      ) : (
        <>
          {step===1 && <Step1 selected={selectedUsers} setSelected={setSelectedUsers} catalog={catalog}/>}
          {step===2 && <Step2 selectedAccess={selectedAccess} setSelectedAccess={setSelectedAccess} catalog={catalog}/>}
          {step===3 && <Step3 selectedUsers={selectedUsers} selectedAccess={selectedAccess} setSelectedAccess={setSelectedAccess} onSubmit={handleSubmit} submitting={submitting}/>}
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:24, paddingTop:20, borderTop:'1px solid var(--border)' }}>
            <button className="btn btn-secondary" onClick={()=>step>1?setStep(step-1):setView('list')}>
              {step===1?'Cancel':'← Back'}
            </button>
            {step<3 && (
              <button className="btn btn-primary"
                disabled={step===1?selectedUsers.length===0:selectedAccess.length===0}
                onClick={()=>setStep(step+1)}>
                Next → {step===1?`(${selectedUsers.length} users)`:`(${selectedAccess.length} items)`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  // ── Request List ──────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Access Requests</div>
          <div className="page-subtitle">{total} total requests</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={fetchRequests}><RefreshCw size={14}/></button>
          <button className="btn btn-primary" onClick={startNew}><Plus size={14}/> New Request</button>
        </div>
      </div>
      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
        <div style={{ position:'relative', flex:1, minWidth:200 }}>
          <Search size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search requests..." style={{ paddingLeft:32 }}/>
        </div>
        <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);}} style={{ width:'auto', minWidth:130 }}>
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
      </div>
      {loading ? (
        <div style={{ textAlign:'center', padding:40, color:'var(--text-muted)' }}>Loading...</div>
      ) : filtered.length===0 ? (
        <div className="empty-state">
          <Shield size={40} style={{ margin:'0 auto 12px', opacity:0.3, display:'block' }}/>
          <div style={{ color:'var(--text-muted)' }}>No access requests found</div>
          <button className="btn btn-primary" style={{ marginTop:14 }} onClick={startNew}><Plus size={14}/> New Request</button>
        </div>
      ) : (
        <>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', minWidth:600 }}>
              <thead><tr>
                <th>Resource</th>
                <th>Requested For</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(r=>(
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight:500, color:'var(--text-primary)' }}>{r.resource_name||'—'}</div>
                      <div style={{ color:'var(--text-muted)' }}>{r.justification?.slice(0,50)}{r.justification?.length>50?'...':''}</div>
                    </td>
                    <td style={{ color:'var(--text-secondary)' }}>{r.target_name||r.requester_name||'—'}</td>
                    <td><span className="badge badge-info">{r.request_type?.replace('_',' ')}</span></td>
                    <td><span className={`badge badge-${r.priority==='critical'?'danger':r.priority==='high'?'warning':r.priority==='medium'?'info':'gray'}`}>{r.priority}</span></td>
                    <td><span className={`badge badge-${statusBadge[r.status]||'gray'}`}>{r.status}</span></td>
                    <td style={{ color:'var(--text-muted)', whiteSpace:'nowrap' }}>{r.requested_at?new Date(r.requested_at).toLocaleDateString():r.created_at?new Date(r.created_at).toLocaleDateString():'-'}</td>
                    <td>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={()=>setDetailId(r.id)}>Details</button>
                        {r.status==='pending' && <button className="btn btn-danger btn-sm" onClick={()=>handleCancel(r.id)}>Cancel</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} limit={limit} onPageChange={setPage} onLimitChange={(l)=>{setLimit(l);setPage(1);}}/>
        </>
      )}
      {detailId && <RequestDetailModal requestId={detailId} onClose={()=>setDetailId(null)}/>}
    </div>
  );
}
