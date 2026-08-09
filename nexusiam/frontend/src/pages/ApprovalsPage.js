import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, ChevronRight, RefreshCw, Clock, Search, Users, User, X } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import Pagination from '../components/Pagination';

const priorityBadge = { critical:'danger', high:'warning', medium:'info', low:'gray' };

function ActionModal({ item, onClose, onDone }) {
  const [action, setAction]     = useState('');
  const [comments, setComments] = useState('');
  const [forwardTo, setForwardTo]   = useState('');
  const [forwardType, setForwardType] = useState('user');
  const [users, setUsers]       = useState([]);
  const [workgroups, setWorkgroups] = useState([]);
  const [loading, setLoading]   = useState(false);

  const needsComments = ['rejected','cancelled','forwarded','reassigned'].includes(action);
  const needsForward  = ['forwarded','reassigned'].includes(action);

  useEffect(() => {
    API.get('/users?limit=200').then(r => setUsers(r.data?.data||[])).catch(()=>{});
    API.get('/workgroups').then(r => setWorkgroups(r.data?.data||r.data||[])).catch(()=>{});
  }, []);

  const submit = async () => {
    if (!action) return toast.error('Select an action');
    if (needsComments && !comments.trim()) return toast.error('Business justification required');
    if (needsForward && !forwardTo) return toast.error('Select user or workgroup');
    setLoading(true);
    try {
      await API.post(`/access-requests/${item.reference_id}/action`, {
        action, comments,
        forward_to_id: forwardTo||undefined,
        forward_to_type: forwardType});
      toast.success(`Request ${action}`);
      onDone();
    } catch(err) { toast.error(err.response?.data?.error||'Failed'); }
    finally { setLoading(false); }
  };

  const ACTIONS = [
    { key:'approved',   label:'Approve',  color:'#10b981', bg:'rgba(16,185,129,0.1)' },
    { key:'rejected',   label:'Reject',   color:'#ef4444', bg:'rgba(239,68,68,0.1)'  },
    { key:'cancelled',  label:'Cancel',   color:'#64748b', bg:'rgba(100,116,139,0.1)' },
    { key:'forwarded',  label:'Forward',  color:'#8b5cf6', bg:'rgba(139,92,246,0.1)' },
    { key:'reassigned', label:'Reassign', color:'#06b6d4', bg:'rgba(6,182,212,0.1)'  },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:560, width:'calc(100vw - 32px)' }} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontWeight:700, color:'var(--text-primary)' }}>Take Action</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={14}/></button>
        </div>
        <div className="modal-body">
          <div style={{ background:'var(--bg-tertiary)', borderRadius:8, padding:12, marginBottom:18 }}>
            <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:4 }}>{item.resource_name}</div>
            <div style={{ color:'var(--text-muted)' }}>
              By <strong>{item.requester_name}</strong> for <strong>{item.target_name||item.requester_name}</strong>
            </div>
            {item.justification && <div style={{ color:'var(--text-muted)', marginTop:6, lineHeight:1.5 }}>{item.justification}</div>}
          </div>

          <div className="form-group">
            <label>Action</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {ACTIONS.map(a => (
                <button key={a.key} type="button" onClick={()=>setAction(a.key)}
                  style={{ flex:'1 1 auto', minWidth:80, padding:'10px 14px', borderRadius:8, cursor:'pointer', fontWeight:600, textAlign:'center',
                    border:`2px solid ${action===a.key?a.color:'var(--border-bright)'}`,
                    background: action===a.key?a.bg:'var(--bg-tertiary)',
                    color: action===a.key?a.color:'var(--text-secondary)',
                    transition:'all 0.15s' }}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {needsForward && (
            <div className="form-group">
              <label>Forward / Reassign To</label>
              <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                {['user','workgroup'].map(t => (
                  <button key={t} type="button" onClick={()=>{setForwardType(t);setForwardTo('');}}
                    className={`btn btn-sm ${forwardType===t?'btn-primary':'btn-secondary'}`}
                    style={{ flex:1, justifyContent:'center' }}>
                    {t==='user'?<User size={13}/>:<Users size={13}/>} {t.charAt(0).toUpperCase()+t.slice(1)}
                  </button>
                ))}
              </div>
              <select value={forwardTo} onChange={e=>setForwardTo(e.target.value)}>
                <option value="">-- Select {forwardType==='workgroup'?'Workgroup':'User'} --</option>
                {forwardType==='user'
                  ? users.map(u=><option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.username})</option>)
                  : workgroups.map(w=><option key={w.id} value={w.id}>{w.name}</option>)
                }
              </select>
              <div style={{ color:'var(--text-muted)', marginTop:4 }}>
                If workgroup is empty, falls back to configured fallback approver.
              </div>
            </div>
          )}

          {(needsComments || action) && (
            <div className="form-group">
              <label>{action==='approved'?'Comments (optional)':'Business Justification *'}</label>
              <textarea value={comments} onChange={e=>setComments(e.target.value)} rows={3}
                placeholder={action==='approved'?'Optional approval notes...':'Explain why you are taking this action...'} />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!action||loading}
            style={{ minWidth:120 }}>
            {loading?'Processing...':'Confirm Action'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestDetailModal({ requestId, onClose }) {
  const [req, setReq]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get(`/access-requests/${requestId}`)
      .then(r=>setReq(r.data))
      .catch(()=>toast.error('Failed to load'))
      .finally(()=>setLoading(false));
  }, [requestId]);

  if (loading) return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:600, padding:40, textAlign:'center' }} onClick={e=>e.stopPropagation()}>
        Loading...
      </div>
    </div>
  );
  if (!req) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:620, width:'calc(100vw - 32px)' }} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontWeight:700, color:'var(--text-primary)' }}>{req.ticket_number}</div>
            <span className={`badge badge-${req.status==='approved'?'success':req.status==='rejected'?'danger':req.status==='pending'?'warning':'gray'}`}>{req.status}</span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={14}/></button>
        </div>
        <div className="modal-body">
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:10, marginBottom:16 }}>
            {[
              ['Resource', req.resource_name],
              ['Type', req.request_type?.replace('_',' ')],
              ['Requested By', req.requester_name],
              ['Requested For', req.target_name||req.requester_name],
              ['Priority', req.priority],
              ['Submitted', req.requested_at?new Date(req.requested_at).toLocaleString():'-'],
            ].map(([k,v])=>(
              <div key={k} style={{ padding:'10px 12px', background:'var(--bg-tertiary)', borderRadius:8 }}>
                <div style={{ color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>{k}</div>
                <div style={{ fontWeight:500, color:'var(--text-primary)' }}>{v||'—'}</div>
              </div>
            ))}
          </div>
          <div style={{ padding:'12px 14px', background:'var(--bg-tertiary)', borderRadius:8, marginBottom:14 }}>
            <div style={{ color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Justification</div>
            <div style={{ color:'var(--text-primary)', lineHeight:1.6 }}>{req.justification||'—'}</div>
          </div>
          {req.resolution_notes && (
            <div style={{ padding:'10px 14px', background:'rgba(245,158,11,0.05)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8 }}>
              <div style={{ color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Notes</div>
              <div style={{ color:'var(--text-secondary)' }}>{req.resolution_notes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const [tab, setTab]           = useState('pending');
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [actionItem, setActionItem] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [page, setPage]         = useState(1);
  const [limit, setLimit]       = useState(15);
  const [total, setTotal]       = useState(0);

  const fetchApprovals = async () => {
    setLoading(true);
    try {
      if (tab === 'pending') {
        const r = await API.get(`/access-requests/my/approvals?page=${page}&limit=${limit}`);
        setItems(r.data?.data||[]);
        setTotal(r.data?.total||0);
      } else {
        // Completed - fetch requests where I was the resolver
        const r = await API.get(`/access-requests?page=${page}&limit=${limit}`);
        const completed = (r.data?.data||[]).filter(i =>
          i.status !== 'pending' && i.resolved_by
        );
        setItems(completed);
        setTotal(r.data?.total||0);
      }
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchApprovals(); }, [tab, page, limit]); // eslint-disable-line

  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    return !q || i.resource_name?.toLowerCase().includes(q) ||
      i.requester_name?.toLowerCase().includes(q) ||
      i.ticket_number?.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Approvals</div>
          <div className="page-subtitle">
            {tab==='pending' ? `${total} item${total!==1?'s':''} awaiting your action` : 'Previously actioned requests'}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={fetchApprovals}><RefreshCw size={14}/></button>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--border)' }}>
        {[
          { key:'pending',   label:'Pending Approvals', count: tab==='pending'?total:null },
          { key:'completed', label:'Completed', count: null },
        ].map(t => (
          <button key={t.key} onClick={()=>{setTab(t.key);setPage(1);}}
            style={{ padding:'10px 20px', background:'none', border:'none',
              borderBottom:`2px solid ${tab===t.key?'var(--accent)':'transparent'}`,
              color: tab===t.key?'var(--accent)':'var(--text-muted)',
              cursor:'pointer', fontWeight:tab===t.key?600:400, marginBottom:-1 }}>
            {t.label}
            {t.count > 0 && (
              <span style={{ marginLeft:6, background:'#ef4444', color:'#fff', borderRadius:10, fontWeight:700, padding:'1px 6px', lineHeight:'16px' }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ position:'relative', marginBottom:16 }}>
        <Search size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search by ticket, resource, or requester..."
          style={{ paddingLeft:32 }}/>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:40, color:'var(--text-muted)' }}>Loading...</div>
      ) : filtered.length===0 ? (
        <div className="empty-state">
          <CheckCircle size={40} style={{ margin:'0 auto 12px', opacity:0.3, display:'block' }}/>
          <div style={{ color:'var(--text-muted)' }}>
            {tab==='pending' ? 'No pending approvals' : 'No completed approvals'}
          </div>
        </div>
      ) : (
        <>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', minWidth:600 }}>
            <thead><tr>
              <th>Ticket</th>
              <th>Resource</th>
              <th>Requested By</th>
              <th>For</th>
              <th>Priority</th>
              {tab==='pending' && <th>Due</th>}
              {tab==='completed' && <th>Status</th>}
              <th style={{ minWidth:140 }}>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map(item=>(
                <tr key={item.id}>
                  <td>
                    <button onClick={()=>setDetailId(item.reference_id||item.id)}
                      style={{ background:'none', border:'none', color:'var(--accent)', cursor:'pointer', fontWeight:600, padding:0, whiteSpace:'nowrap' }}>
                      {item.ticket_number||'—'}
                    </button>
                  </td>
                  <td>
                    <div style={{ fontWeight:500, color:'var(--text-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:160 }}>
                      {item.resource_name||'—'}
                    </div>
                    <div style={{ color:'var(--text-muted)' }}>{item.request_type?.replace('_',' ')}</div>
                  </td>
                  <td style={{ color:'var(--text-secondary)', whiteSpace:'nowrap' }}>{item.requester_name||'—'}</td>
                  <td style={{ color:'var(--text-secondary)', whiteSpace:'nowrap' }}>{item.target_name||item.requester_name||'—'}</td>
                  <td><span className={`badge badge-${priorityBadge[item.priority]||'gray'}`}>{item.priority}</span></td>
                  {tab==='pending' && (
                    <td style={{ color: item.due_at&&new Date(item.due_at)<new Date()?'var(--danger)':'var(--text-muted)', whiteSpace:'nowrap' }}>
                      {item.due_at?new Date(item.due_at).toLocaleDateString():'-'}
                    </td>
                  )}
                  {tab==='completed' && (
                    <td><span className={`badge badge-${item.status==='approved'?'success':item.status==='rejected'?'danger':'gray'}`}>{item.status}</span></td>
                  )}
                  <td>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {tab==='pending' && (
                        <button className="btn btn-primary btn-sm" onClick={()=>setActionItem(item)}
                          style={{ whiteSpace:'nowrap' }}>
                          Act <ChevronRight size={12}/>
                        </button>
                      )}
                      <button className="btn btn-secondary btn-sm"
                        onClick={()=>setDetailId(item.reference_id||item.id)}
                        style={{ whiteSpace:'nowrap' }}>
                        Details
                      </button>
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

      {actionItem && (
        <ActionModal item={actionItem} onClose={()=>setActionItem(null)}
          onDone={()=>{ setActionItem(null); fetchApprovals(); }}/>
      )}
      {detailId && (
        <RequestDetailModal requestId={detailId} onClose={()=>setDetailId(null)}/>
      )}
    </div>
  );
}
