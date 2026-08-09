import React, { useEffect, useMemo, useState, useCallback } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { Download, RefreshCw, Upload, Filter, X, Plus, Trash2 } from 'lucide-react';
import PaginationControls from '../components/PaginationControls';
import OwnerPicker from '../components/OwnerPicker';

const emptyFilters = {
  application_id: '', type: '', attribute: '', value: '',
  owner: '', requestable: '', classification: '', elevated_access: '',
};
const CLASSIFICATION_OPTIONS = ['', 'sensitive', 'privileged', 'public', 'confidential', 'restricted'];

export default function EntitlementsPage() {
  const [catalog, setCatalog]         = useState({ applications: [], attributes: [], types: [] });
  const [filters, setFilters]         = useState(emptyFilters);
  const [rows, setRows]               = useState([]);
  const [pagination, setPagination]   = useState({ page: 1, limit: 15, total: 0, pages: 0 });
  const [loading, setLoading]         = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [importText, setImportText]   = useState('');
  const [showImport, setShowImport]   = useState(false);
  const [editEnt, setEditEnt]         = useState(null);
  const [editForm, setEditForm]       = useState({});
  const [editSaving, setEditSaving]   = useState(false);
  const [metaFields, setMetaFields]   = useState([]);
  const [selected, setSelected]       = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const loadCatalog = async () => {
    try { const { data } = await API.get('/entitlements/catalog'); setCatalog(data); } catch {}
  };

  const loadData = useCallback(async (page = 1, limit = 15) => {
    setLoading(true);
    try {
      const { data } = await API.get('/entitlements', { params: { ...filters, page, limit } });
      setRows(data.data || []);
      setPagination(data.pagination || { page, limit, total: 0, pages: 0 });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load entitlements');
    } finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { loadCatalog(); loadData(1, 25); }, []); // eslint-disable-line

  const doSearch = () => loadData(1, pagination.limit);
  const doReset  = () => { setFilters(emptyFilters); setTimeout(() => loadData(1, pagination.limit), 0); };

  const doExport = async () => {
    const r = await API.get('/entitlements/export/file', { params: filters, responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([r.data]));
    const a = document.createElement('a'); a.href = url; a.download = 'entitlements.csv'; a.click();
    window.URL.revokeObjectURL(url);
  };

  const doImport = async () => {
    try {
      await API.post('/entitlements/import', { items: JSON.parse(importText || '[]') });
      toast.success('Imported'); setShowImport(false); setImportText('');
      loadCatalog(); loadData(1, pagination.limit);
    } catch (e) { toast.error(e.response?.data?.error || 'Import failed — paste valid JSON array'); }
  };

  const toggleRequestable = async (row) => {
    if (row.source !== 'managed') { toast.error('Manage the entitlement first to control requestable'); return; }
    try {
      await API.put(`/entitlements/${row.id}/requestable`, { requestable: !row.requestable });
      loadData(pagination.page, pagination.limit);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const openEdit = (row) => {
    setEditEnt(row);
    const meta = row.metadata || {};
    setEditForm({
      display_value: row.display_name || row.value || '',
      description: row.description || '',
      requestable: !!row.requestable,
      elevated_access: !!(row.elevated_access || meta.elevated_access),
      classification: row.classification || meta.classification || '',
      owner: row.owner_id ? { id: row.owner_id, name: row.owner_name, type: row.owner_type || 'identity' } : null});
    const reserved = new Set(['connector_id','group_id','member_count','requestable','elevated_access','classification','owner']);
    setMetaFields(Object.entries(meta).filter(([k]) => !reserved.has(k)).map(([k,v]) => ({ key: k, value: String(v) })));
  };

  const saveEdit = async () => {
    setEditSaving(true);
    try {
      const customMeta = {};
      metaFields.forEach(({ key, value }) => { if (key.trim()) customMeta[key.trim()] = value; });
      await API.put(`/entitlements/${editEnt.id}`, {
        display_value: editForm.display_value, description: editForm.description,
        requestable: editForm.requestable, elevated_access: editForm.elevated_access,
        classification: editForm.classification,
        owner_id: editForm.owner?.id || null, owner_type: editForm.owner?.type || 'identity',
        owner_workgroup_id: editForm.owner?.type === 'workgroup' ? editForm.owner?.id : null,
        custom_metadata: customMeta});
      toast.success('Entitlement saved'); setEditEnt(null);
      loadData(pagination.page, pagination.limit);
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    setEditSaving(false);
  };

  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    const managedIds = rows.filter(r => r.source === 'managed').map(r => r.id);
    const allManaged = managedIds.every(id => selected.has(id));
    setSelected(prev => {
      const n = new Set(prev);
      managedIds.forEach(id => allManaged ? n.delete(id) : n.add(id));
      return n;
    });
  };

  const doDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} entitlement(s)? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      await API.post('/entitlements/bulk-delete', { ids: [...selected] });
      toast.success(`${selected.size} entitlement(s) deleted`);
      setSelected(new Set());
      loadCatalog();
      loadData(pagination.page, pagination.limit);
    } catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
    setBulkDeleting(false);
  };

  const doDeleteSingle = async (row) => {
    if (!window.confirm(`Delete entitlement "${row.display_name || row.name || row.value}"? This cannot be undone.`)) return;
    try {
      await API.delete(`/entitlements/${row.id}`);
      toast.success('Entitlement deleted');
      setSelected(prev => { const n = new Set(prev); n.delete(row.id); return n; });
      loadData(pagination.page, pagination.limit);
    } catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
  };

  const activeCount = Object.values(filters).filter(v => v !== '').length;
  const appOptions  = useMemo(() => catalog.applications || [], [catalog]);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Entitlements</div>
          <div className="page-subtitle">{pagination.total} entitlement{pagination.total !== 1 ? 's' : ''} · Manage catalog, owners, and requestable access</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={() => loadData(pagination.page, pagination.limit)}><RefreshCw size={14} /></button>
          <button className="btn btn-secondary" onClick={doExport}><Download size={14} /> Export</button>
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}><Upload size={14} /> Import</button>
          <button className={`btn ${showFilters ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowFilters(f => !f)} style={{ position:'relative' }}>
            <Filter size={14} /> Advanced Search
            {activeCount > 0 && (
              <span style={{ position:'absolute', top:-6, right:-6, background:'#ef4444', color:'#fff', borderRadius:10, width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>{activeCount}</span>
            )}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="card" style={{ marginBottom:16, borderColor:'#2a3f5a' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <span style={{ color:'#38bdf8', fontWeight:600 }}>Standard Attributes</span>
            <button onClick={() => setShowFilters(false)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer' }}><X size={16} /></button>
          </div>
          <div className="form-row form-row-3">
            <div className="form-group"><label>Application</label>
              <select value={filters.application_id} onChange={e => setFilters(f => ({ ...f, application_id: e.target.value }))}>
                <option value="">All Applications</option>
                {appOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Type</label>
              <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
                <option value="">All</option>
                {(catalog.types||[]).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Attribute</label>
              <select value={filters.attribute} onChange={e => setFilters(f => ({ ...f, attribute: e.target.value }))}>
                <option value="">All</option>
                {(catalog.attributes||[]).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row form-row-4">
            <div className="form-group"><label>Value</label><input value={filters.value} onChange={e => setFilters(f => ({ ...f, value: e.target.value }))} placeholder="Search value…" /></div>
            <div className="form-group"><label>Owner</label><input value={filters.owner} onChange={e => setFilters(f => ({ ...f, owner: e.target.value }))} placeholder="Owner name…" /></div>
            <div className="form-group"><label>Requestable</label>
              <select value={filters.requestable} onChange={e => setFilters(f => ({ ...f, requestable: e.target.value }))}>
                <option value="">All</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </div>
            <div className="form-group"><label>Elevated Access</label>
              <select value={filters.elevated_access} onChange={e => setFilters(f => ({ ...f, elevated_access: e.target.value }))}>
                <option value="">All</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </div>
          </div>
          <div className="form-row form-row-2">
            <div className="form-group"><label>Classification</label>
              <select value={filters.classification} onChange={e => setFilters(f => ({ ...f, classification: e.target.value }))}>
                {CLASSIFICATION_OPTIONS.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, paddingTop:4 }}>
            <button className="btn btn-primary" onClick={doSearch}>Search</button>
            <button className="btn btn-secondary" onClick={doReset}>Reset</button>
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', background:'#0f2744', border:'1px solid #1d4ed8', borderRadius:8, marginBottom:12 }}>
          <span style={{ color:'#93c5fd', fontWeight:600 }}>{selected.size} entitlement{selected.size !== 1 ? 's' : ''} selected</span>
          <button className="btn btn-danger btn-sm" onClick={doDeleteSelected} disabled={bulkDeleting}>
            <Trash2 size={13} style={{ marginRight:4 }} />{bulkDeleting ? 'Deleting…' : 'Delete Selected'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="card" style={{ padding:0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width:40, textAlign:'center' }}>
                <input type="checkbox"
                  checked={rows.filter(r => r.source === 'managed').length > 0 && rows.filter(r => r.source === 'managed').every(r => selected.has(r.id))}
                  onChange={toggleAll}
                  style={{ cursor:'pointer' }} />
              </th>
              <th>Application</th><th>Attribute</th><th>Display Name</th><th>Type</th>
              <th>Owner</th><th>Requestable</th><th>Elevated</th><th>Classification</th><th>Accounts</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={11} style={{ padding:24, textAlign:'center', color:'var(--text-muted)' }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={11} style={{ padding:24, textAlign:'center', color:'var(--text-muted)' }}>No entitlements found.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} style={{ background: selected.has(r.id) ? 'rgba(29,78,216,0.08)' : undefined }}>
                <td style={{ textAlign:'center', width:40 }}>
                  {r.source === 'managed'
                    ? <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} style={{ cursor:'pointer', accentColor:'#06b6d4' }} />
                    : <span style={{ color:'var(--text-muted)', fontSize:12 }} title="Discovered — delete from source">—</span>}
                </td>
                <td style={{ color:'var(--text-secondary)' }}>
                  {r.application_name
                    ? <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.application_name}</div>
                        {r.connector_type && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{r.connector_type.replace(/_/g,' ')}</div>}
                      </div>
                    : '—'}
                </td>
                <td style={{ color:'var(--text-secondary)' }}>{r.attribute||r.type||'—'}</td>
                <td>
                  <button onClick={() => openEdit(r)} style={{ background:'none', border:'none', color:'#38bdf8', cursor:'pointer', padding:0 }}>
                    {r.display_name||r.value}
                  </button>
                </td>
                <td><span style={{ background:'rgba(16,185,129,0.1)', color:'#34d399', borderRadius:4, padding:'2px 6px' }}>{r.type||'—'}</span></td>
                <td style={{ color:'var(--text-secondary)' }}>
                  {r.owner_name ? <span>{r.owner_type==='workgroup'?'👥 ':'👤 '}{r.owner_name}</span> : '—'}
                </td>
                <td style={{ textAlign:'center' }}>
                  <input type="checkbox" checked={!!r.requestable} onChange={() => toggleRequestable(r)} style={{ accentColor:'#10b981', cursor:'pointer' }} />
                </td>
                <td style={{ textAlign:'center' }}>
                  {r.elevated_access ? <span style={{ color:'#f59e0b' }}>⚡</span> : <span style={{ color:'var(--text-secondary)' }}>—</span>}
                </td>
                <td>
                  {r.classification
                    ? <span style={{ background:'rgba(139,92,246,0.15)', color:'#a78bfa', borderRadius:4, padding:'2px 6px' }}>{r.classification}</span>
                    : '—'}
                </td>
                <td style={{ color:'var(--text-muted)' }}>{r.account_count||0}</td>
                <td>
                  <div style={{ display:'flex', gap:4 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(r)}>Edit</button>
                    {r.source === 'managed' && (
                      <button className="btn btn-danger btn-sm" onClick={() => doDeleteSingle(r)} title="Delete entitlement">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <PaginationControls page={pagination.page} pages={pagination.pages} limit={pagination.limit} total={pagination.total}
          onPageChange={p => loadData(p, pagination.limit)} onLimitChange={l => loadData(1, l)} />
      </div>

      {editEnt && (
        <div className="modal-overlay" onClick={() => setEditEnt(null)}>
          <div className="modal" style={{ maxWidth:620, width:'95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span style={{ fontWeight:700, color:'var(--text-primary)' }}>Edit Entitlement</span>
                <div style={{ color:'var(--text-muted)', marginTop:2 }}>{editEnt.application_name} · {editEnt.type}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditEnt(null)}>×</button>
            </div>
            <div className="modal-body" style={{ overflowY:'auto', maxHeight:'75vh' }}>
              <div style={{ background:'var(--bg-primary)', borderRadius:8, padding:14, marginBottom:18, border:'1px solid #1e2a3a' }}>
                <div style={{ color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>Standard Properties</div>
                {[['Application',editEnt.application_name||'—'],['Type',editEnt.type||'—'],['Attribute',editEnt.attribute||'—'],['Value',editEnt.value||'—']].map(([k,v]) => (
                  <div key={k} style={{ display:'flex', gap:12, marginBottom:6 }}>
                    <span style={{ color:'var(--text-muted)', minWidth:80 }}>{k}</span>
                    <span style={{ color:'var(--border-bright)', fontFamily:k==='Value'?'monospace':'inherit' }}>{v}</span>
                  </div>
                ))}
              </div>

              <div className="form-group"><label>Display Value</label>
                <input className="form-control" value={editForm.display_value} onChange={e => setEditForm(f => ({ ...f, display_value:e.target.value }))} />
              </div>
              <div className="form-group"><label>Description</label>
                <textarea className="form-control" rows={3} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description:e.target.value }))} placeholder="Describe this entitlement…" />
              </div>
              <div className="form-group">
                <label>Owner <span style={{ color:'var(--text-muted)', fontWeight:400 }}>(identity or workgroup)</span></label>
                <OwnerPicker value={editForm.owner} onChange={owner => setEditForm(f => ({ ...f, owner }))} placeholder="Assign owner…" />
              </div>
              <div className="form-group"><label>Classification</label>
                <select className="form-control" value={editForm.classification} onChange={e => setEditForm(f => ({ ...f, classification:e.target.value }))}>
                  {CLASSIFICATION_OPTIONS.map(c => <option key={c} value={c}>{c||'— None —'}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', gap:24, marginBottom:20 }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', color:'var(--border-bright)' }}>
                  <input type="checkbox" checked={editForm.requestable} onChange={e => setEditForm(f => ({ ...f, requestable:e.target.checked }))} style={{ accentColor:'#10b981' }} />
                  Requestable
                </label>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', color:'var(--border-bright)' }}>
                  <input type="checkbox" checked={editForm.elevated_access} onChange={e => setEditForm(f => ({ ...f, elevated_access:e.target.checked }))} style={{ accentColor:'#f59e0b' }} />
                  <span style={{ color:editForm.elevated_access?'#fbbf24':'var(--border-bright)' }}>Elevated Access ⚡</span>
                </label>
              </div>

              <div style={{ borderTop:'1px solid #1e2a3a', paddingTop:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <span style={{ color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:1 }}>Custom Metadata</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => setMetaFields(f => [...f, { key:'', value:'' }])}><Plus size={12} /> Add Field</button>
                </div>
                {metaFields.length === 0 && <div style={{ color:'var(--text-secondary)' }}>No custom metadata.</div>}
                {metaFields.map((field, i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:8, alignItems:'center' }}>
                    <input className="form-control" placeholder="Key" value={field.key}
                      onChange={e => setMetaFields(f => f.map((x,idx) => idx===i?{ ...x, key:e.target.value }:x))}
                      style={{ flex:1, fontFamily:'monospace' }} />
                    <input className="form-control" placeholder="Value" value={field.value}
                      onChange={e => setMetaFields(f => f.map((x,idx) => idx===i?{ ...x, value:e.target.value }:x))}
                      style={{ flex:2 }} />
                    <button onClick={() => setMetaFields(f => f.filter((_,idx) => idx!==i))}
                      style={{ background:'none', border:'1px solid #ef444430', borderRadius:4, color:'#ef4444', width:28, height:28, cursor:'pointer', flexShrink:0 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditEnt(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={editSaving}>{editSaving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span style={{ fontWeight:600, color:'var(--text-primary)' }}>Import Entitlements</span><button className="btn btn-secondary btn-sm" onClick={() => setShowImport(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-group"><label>Paste JSON array</label>
                <textarea rows={12} className="mono" value={importText} onChange={e => setImportText(e.target.value)}
                  placeholder='[{"application_id":"...","display_name":"Finance Admin","type":"group","value":"finance-admin","requestable":true}]' />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowImport(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doImport}>Import</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
