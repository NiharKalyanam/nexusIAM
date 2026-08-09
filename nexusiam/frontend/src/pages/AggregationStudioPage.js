import React, { useEffect, useState, useCallback } from 'react';
import { Play, RefreshCw, Eye, Trash2, CheckSquare, Tag } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

export default function AggregationStudioPage() {
  const [jobs, setJobs] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [applications, setApplications] = useState([]);
  const [detailJob, setDetailJob] = useState(null);
  const [detailTab, setDetailTab] = useState('summary');
  const [entitlements, setEntitlements] = useState([]);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [form, setForm] = useState({ connector_id: '', job_name: '', aggregation_type: 'account', mode: 'full', schedule_cron: '0 2 * * *', mark_requestable: false });
  const [selectedJobIds, setSelectedJobIds] = useState([]);

  const load = async () => {
    try {
      const [j, c, a] = await Promise.all([API.get('/aggregations'), API.get('/connectors'), API.get('/applications')]);
      setJobs(j.data || []);
      setSelectedJobIds([]);
      setConnectors(c.data || []);
      setApplications(a.data || []);
      if (!form.connector_id && c.data?.[0]?.id) {
        setForm(f => ({ ...f, connector_id: c.data[0].id, job_name: `${c.data[0].name} Account Aggregation` }));
      }
    } catch { toast.error('Failed to load aggregation studio'); }
  };

  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    await API.post('/aggregations', form);
    toast.success('Aggregation job saved');
    setForm({ connector_id: connectors[0]?.id || '', job_name: '', aggregation_type: 'account', mode: 'full', schedule_cron: '0 2 * * *', mark_requestable: false });
    load();
  };

  const [search, setSearch] = useState('');
  const [editingJob, setEditingJob] = useState(null);
  const [runningIds, setRunningIds] = useState(new Set());

  const run = async (id) => {
    setRunningIds(prev => new Set([...prev, id]));
    try {
      // Optimistically set status to running in local state
      setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'running' } : j));
      // Fire the run — backend sets status=running immediately
      API.post(`/aggregations/${id}/run`).then(async (r) => {
        toast.success(`Aggregation completed`);
        setRunningIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        await load();
      }).catch(err => {
        toast.error(err.response?.data?.error || 'Aggregation failed');
        setRunningIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'failed' } : j));
      });

      // Poll status every 3 seconds until no longer running
      const poll = setInterval(async () => {
        try {
          const s = await API.get(`/aggregations/${id}/status`);
          setJobs(prev => prev.map(j => j.id === id ? { ...j, status: s.data.status, last_run_at: s.data.last_run_at } : j));
          if (s.data.status !== 'running') clearInterval(poll);
        } catch { clearInterval(poll); }
      }, 3000);
      // Safety: stop polling after 5 minutes
      setTimeout(() => clearInterval(poll), 300000);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start aggregation');
      setRunningIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    try {
      await API.put(`/aggregations/${editingJob.id}`, editingJob);
      toast.success('Job updated');
      setEditingJob(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to update job'); }
  };

  const filteredJobs = jobs.filter(j =>
    !search ||
    j.job_name?.toLowerCase().includes(search.toLowerCase()) ||
    j.connector_name?.toLowerCase().includes(search.toLowerCase())
  );

  const loadEntitlements = useCallback(async (connectorId) => {
    if (!connectorId) return;
    setEntitlementsLoading(true);
    try {
      const { data } = await API.get('/entitlements', { params: { connector_id: connectorId, limit: 200 } });
      setEntitlements(data.entitlements || data.data || []);
    } catch { setEntitlements([]); }
    finally { setEntitlementsLoading(false); }
  }, []);

  const openDetailModal = async (job) => {
    setDetailJob(job);
    setDetailTab('summary');
    setEntitlements([]);
    if (job.aggregation_type === 'group' && job.connector_id) {
      await loadEntitlements(job.connector_id);
    }
  };

  const openDetails = async (id) => {
    try {
      const r = await API.get(`/aggregations/${id}`);
      openDetailModal(r.data);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to load aggregation details'); }
  };

  const toggleRequestable = async (entitlement) => {
    const newVal = !entitlement.requestable;
    try {
      await API.put(`/entitlements/${entitlement.id}/requestable`, { requestable: newVal });
      setEntitlements(prev => prev.map(e => e.id === entitlement.id ? { ...e, requestable: newVal } : e));
      toast.success(`"${entitlement.name || entitlement.value}" marked ${newVal ? 'requestable' : 'not requestable'}`);
    } catch { toast.error('Failed to update requestable flag'); }
  };

  const toggleSelection = (id) =>
    setSelectedJobIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleSelectAllVisible = () =>
    setSelectedJobIds(selectedJobIds.length === jobs.length ? [] : jobs.map(j => j.id));

  const deleteSelected = async () => {
    if (!selectedJobIds.length) return;
    const justification = window.prompt(`Delete ${selectedJobIds.length} saved job(s)?\n\nEnter business justification:`);
    if (justification === null) return;
    if (!String(justification).trim()) { toast.error('Business justification is required'); return; }
    if (!window.confirm(`Final confirmation: delete ${selectedJobIds.length} selected job(s)?`)) return;
    try {
      const { data } = await API.post('/aggregations/delete-bulk', { ids: selectedJobIds, justification: String(justification).trim() });
      toast.success(`Deleted ${data.deletedCount || selectedJobIds.length} job(s)`);
      await load();
      if (detailJob && selectedJobIds.includes(detailJob.id)) setDetailJob(null);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to delete selected jobs'); }
  };

  const summary = detailJob?.last_result || {};
  const isGroupJob = detailJob?.aggregation_type === 'group';
  const requestableCount = entitlements.filter(e => e.requestable).length;

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
          <div className="page-title">Aggregation Studio</div>
          <div className="page-subtitle">Run account and group aggregation like an IAM product, not a hardcoded demo</div>
        </div>
      </div>

      {/* Create Job Form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>New Aggregation Job</div>
        <form onSubmit={save}>
          <div className="form-group">
            <label>Connector</label>
            <select value={form.connector_id} onChange={e => {
              const c = connectors.find(x => x.id === e.target.value);
              const appForConnector = applications.find(a => a.metadata?.connector_id === e.target.value || a.provisioning_config?.connector_id === e.target.value);
              const displayName = appForConnector ? appForConnector.name : c?.name;
              setForm({ ...form, connector_id: e.target.value, job_name: displayName ? `${displayName} ${form.aggregation_type === 'group' ? 'Group' : 'Account'} Aggregation` : form.job_name });
            }}>
              {connectors.map(c => {
                const linkedApp = applications.find(a => a.metadata?.connector_id === c.id || a.provisioning_config?.connector_id === c.id);
                return <option key={c.id} value={c.id}>{linkedApp ? `${linkedApp.name} (${c.name})` : c.name} • {c.type}</option>;
              })}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>Job Name</label>
              <input value={form.job_name} onChange={e => setForm({ ...form, job_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={form.aggregation_type} onChange={e => setForm({ ...form, aggregation_type: e.target.value })}>
                <option value="account">Account</option>
                <option value="group">Group / Entitlement</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>Mode</label>
              <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}>
                <option value="full">Full</option>
                <option value="delta">Delta</option>
                <option value="targeted">Targeted</option>
              </select>
            </div>
            <div className="form-group">
              <label>Schedule (cron)</label>
              <input value={form.schedule_cron} onChange={e => setForm({ ...form, schedule_cron: e.target.value })} placeholder="0 2 * * *" />
            </div>
          </div>
          {form.aggregation_type === 'group' && (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'rgba(139,92,246,0.07)', border:'1px solid rgba(139,92,246,0.25)', borderRadius:8, marginBottom:12 }}>
              <input
                type="checkbox"
                id="markRequestable"
                checked={form.mark_requestable}
                onChange={e => setForm({ ...form, mark_requestable: e.target.checked })}
                style={{ accentColor:'#8b5cf6', width:15, height:15, cursor:'pointer' }}
              />
              <label htmlFor="markRequestable" style={{ cursor:'pointer', margin:0, fontWeight:500, color:'#c4b5fd' }}>
                Auto-mark discovered groups as <strong style={{ color:'#8b5cf6' }}>Requestable</strong>
              </label>
              <span style={{ color:'var(--text-muted)', marginLeft:4 }}>
                (Groups will appear in the Access Request catalog immediately after aggregation)
              </span>
            </div>
          )}
          <button type="submit" className="btn btn-primary">Save Job</button>
        </form>
        <div style={{ marginTop: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Each connector can have separate account and group aggregation jobs.
          Use <b style={{ color: 'var(--text-secondary)' }}>Details</b> after a run to review counts, status, and configure entitlements as requestable.
        </div>
        <div style={{ marginTop: 14 }}>
          <input
            style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid #1e293b', borderRadius: 8, color: 'var(--text-primary)' }}
            placeholder="Search jobs by name or connector…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedJobIds.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#1a0a2e', border: '1px solid #7c3aed50', borderRadius: 8, marginBottom: 12 }}>
          <span style={{ color: '#a78bfa', fontWeight: 600 }}>{selectedJobIds.length} job{selectedJobIds.length > 1 ? 's' : ''} selected</span>
          <button className="btn btn-danger btn-sm" onClick={deleteSelected}>
            <Trash2 size={13} style={{ marginRight: 4 }} />Delete Selected
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelectedJobIds([])}>Clear</button>
        </div>
      )}

      {/* Jobs Table */}
      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox"
                  checked={jobs.length > 0 && selectedJobIds.length === jobs.length}
                  onChange={toggleSelectAllVisible} />
              </th>
              <th>Job</th>
              <th>Application</th>
              <th>Connector</th>
              <th>Type</th>
              <th>Status</th>
              <th>Last Run</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.map(j => (
              <tr key={j.id}>
                <td style={{ width: 40, textAlign: 'center' }}>
                  <input type="checkbox"
                    checked={selectedJobIds.includes(j.id)}
                    onChange={() => toggleSelection(j.id)}
                    onClick={e => e.stopPropagation()} />
                </td>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{j.job_name}</td>
                <td>
                  {j.application_name
                    ? <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{j.application_name}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{j.connector_name || '—'}</div>
                      </div>
                    : <span style={{ color: 'var(--text-secondary)' }}>{j.connector_name || '—'}</span>}
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{j.connector_type ? j.connector_type.replace(/_/g,' ') : '—'}</td>
                <td>
                  <span className={'badge ' + (j.aggregation_type === 'group' ? 'badge-purple' : 'badge-info')}>
                    {j.aggregation_type}
                  </span>
                </td>
                <td>
                  <span className={'badge badge-' + (j.status === 'completed' ? 'success' : j.status === 'failed' ? 'danger' : j.status === 'running' ? 'warning' : 'gray')}>
                    {j.status}
                  </span>
                </td>
                <td style={{ color: 'var(--text-muted)' }}>
                  {j.last_run_at ? new Date(j.last_run_at).toLocaleString() : 'Never'}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => run(j.id)} disabled={runningIds.has(j.id) || j.status === 'running'}>
                      {(runningIds.has(j.id) || j.status === 'running')
                        ? <><div style={{ width:10,height:10,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite',display:'inline-block',marginRight:4 }} />Running…</>
                        : <><Play size={13} style={{ marginRight: 4 }} />Run</>}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openDetails(j.id)}>
                      <Eye size={13} style={{ marginRight: 4 }} />Details
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingJob({...j})} title="Edit job settings">
                      ✏️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredJobs.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                  No aggregation jobs yet. Create one above to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Job Modal */}
      {editingJob && (
        <div className="modal-overlay" onClick={() => setEditingJob(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Edit Aggregation Job</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditingJob(null)}>×</button>
            </div>
            <form onSubmit={saveEdit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Job Name *</label>
                  <input value={editingJob.job_name || ''} onChange={e => setEditingJob({...editingJob, job_name: e.target.value})} required />
                </div>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label>Aggregation Type</label>
                    <select value={editingJob.aggregation_type || 'account'} onChange={e => setEditingJob({...editingJob, aggregation_type: e.target.value})}>
                      <option value="account">Account</option>
                      <option value="group">Group</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Mode</label>
                    <select value={editingJob.mode || 'full'} onChange={e => setEditingJob({...editingJob, mode: e.target.value})}>
                      <option value="full">Full</option>
                      <option value="incremental">Incremental</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Schedule (cron)</label>
                  <input value={editingJob.schedule_cron || ''} onChange={e => setEditingJob({...editingJob, schedule_cron: e.target.value})} placeholder="0 2 * * *" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingJob(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailJob && (
        <div className="modal-overlay" onClick={() => setDetailJob(null)}>
          <div className="modal" style={{ maxWidth: 980, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                Aggregation Details • {detailJob.job_name}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setDetailJob(null)}>×</button>
            </div>

            {/* Tabs — show Entitlements tab only for group jobs */}
            <div style={{ display: 'flex', gap: 4, padding: '0 24px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
              {tabBtn('summary', 'Summary')}
              {tabBtn('runs', 'Run History')}
              {isGroupJob && tabBtn('entitlements', 'Entitlements', entitlements.length || undefined)}
            </div>

            <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>

              {/* ── Summary Tab ─────────────────────────────────────── */}
              {detailTab === 'summary' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
                    {[
                      ['Status', detailJob.status],
                      ['Connector', detailJob.connector_name || '—'],
                      ['Type', detailJob.aggregation_type],
                      ['Last Run', detailJob.last_run_at ? new Date(detailJob.last_run_at).toLocaleString() : 'Never'],
                    ].map(([k, v]) => (
                      <div key={k} className="card">
                        <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{k}</div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Latest Result</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 12 }}>
                      {isGroupJob ? [
                        ['Groups', summary.groups || summary.added || 0],
                        ['Entitlements Created', summary.entitlements_created || 0],
                        ['Updated', summary.updated || 0],
                        ['Errors', summary.errors || 0],
                        ['Skipped', summary.skipped || 0],
                      ] : [
                        ['Added', summary.added || 0],
                        ['Updated', summary.updated || 0],
                        ['Removed', summary.removed || 0],
                        ['Errors', summary.errors || 0],
                        ['Skipped', summary.skipped || 0],
                        ['Accounts', summary.accounts || 0],
                        ['Linked', summary.linked || 0],
                        ['Unlinked', summary.unlinked || 0],
                      ].map(([k, v]) => (
                        <div key={k} className="card" style={{ padding: '8px 12px' }}>
                          <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{k}</div>
                          <div style={{ color: 'var(--text-primary)', fontWeight: 700, marginTop: 2 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {!isGroupJob && (
                      <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--border-bright)', margin: 0 }}>
                        {JSON.stringify(detailJob.last_result || {}, null, 2)}
                      </pre>
                    )}
                    {(summary.errorDetails?.length > 0 || summary.errors > 0) && (
                      <div style={{ marginTop: 10, background: 'var(--bg-tertiary)', border: '1px solid #ef444430', borderRadius: 6, padding: 10 }}>
                        <div style={{ color: '#ef4444', fontWeight: 600, marginBottom: 6 }}>
                          Error Details ({summary.errors} error{summary.errors !== 1 ? 's' : ''})
                        </div>
                        {(summary.errorDetails || []).map((e, i) => (
                          <div key={i} style={{ color: '#fca5a5', fontFamily: 'monospace', marginBottom: 4, padding: '4px 6px', background: 'rgba(239,68,68,0.05)', borderRadius: 4 }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{e.groupName || e.nativeIdentity}: </span>{e.error}
                          </div>
                        ))}
                        {!summary.errorDetails?.length && (
                          <div style={{ color: 'var(--text-secondary)' }}>Check backend logs for details: <code>docker-compose logs backend | grep GROUP-PULL</code></div>
                        )}
                      </div>
                    )}
                  </div>

                  {isGroupJob && entitlements.length > 0 && (
                    <div style={{ background: '#0f1f2e', border: '1px solid #1d4ed850', borderRadius: 8, padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#93c5fd' }}>
                        <Tag size={14} />
                        <span><strong>{requestableCount}</strong> of <strong>{entitlements.length}</strong> discovered entitlements marked as requestable</span>
                        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setDetailTab('entitlements')}>
                          Manage Entitlements →
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Run History Tab ──────────────────────────────────── */}
              {detailTab === 'runs' && (
                <div className="card" style={{ padding: 0 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Status</th>
                        <th>Processed</th>
                        <th>Success</th>
                        <th>Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailJob.recent_runs || []).length === 0 ? (
                        <tr><td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>No run history yet.</td></tr>
                      ) : (detailJob.recent_runs || []).map(r => (
                        <tr key={r.id}>
                          <td style={{ color: 'var(--text-secondary)' }}>{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</td>
                          <td>
                            <span className={'badge badge-' + (r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : 'warning')}>
                              {r.status}
                            </span>
                          </td>
                          <td>{r.records_processed || 0}</td>
                          <td style={{ color: '#10b981' }}>{r.success_count || 0}</td>
                          <td style={{ color: r.error_count > 0 ? '#ef4444' : 'var(--text-secondary)' }}>{r.error_count || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Entitlements Tab (Group jobs only) ───────────────── */}
              {detailTab === 'entitlements' && isGroupJob && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      Toggle the <strong style={{ color: 'var(--text-primary)' }}>Requestable</strong> flag to make entitlements available in the Access Request catalog. Changes save instantly.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span className="badge badge-success">{requestableCount} requestable</span>
                      <span className="badge badge-gray">{entitlements.length - requestableCount} not requestable</span>
                    </div>
                  </div>

                  {entitlementsLoading ? (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>Loading entitlements...</div>
                  ) : entitlements.length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
                      No entitlements discovered yet. Run this group aggregation job first.
                    </div>
                  ) : (
                    <div className="card" style={{ padding: 0 }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Entitlement Name</th>
                            <th>Type</th>
                            <th>Value</th>
                            <th>Accounts</th>
                            <th style={{ textAlign: 'center', width: 140 }}>Requestable</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entitlements.map(e => (
                            <tr key={e.id}>
                              <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{e.name || e.display_name || e.value || '—'}</td>
                              <td>
                                <span className="badge badge-gray" style={{ }}>{e.type || e.attribute || '—'}</span>
                              </td>
                              <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{e.value || '—'}</td>
                              <td>
                                <span className="badge badge-info" style={{ }}>{e.account_count || 0}</span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                                  <div
                                    onClick={() => toggleRequestable(e)}
                                    style={{
                                      width: 40, height: 22, borderRadius: 11,
                                      background: e.requestable ? '#10b981' : 'var(--border-bright)',
                                      position: 'relative', cursor: 'pointer',
                                      transition: 'background 0.2s',
                                      flexShrink: 0,
                                      border: '1px solid ' + (e.requestable ? '#059669' : 'var(--text-secondary)') }}
                                  >
                                    <div style={{
                                      position: 'absolute', top: 2,
                                      left: e.requestable ? 20 : 2,
                                      width: 16, height: 16, borderRadius: '50%',
                                      background: '#fff', transition: 'left 0.2s',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
                                  </div>
                                  <span style={{ color: e.requestable ? '#10b981' : 'var(--text-muted)', fontWeight: e.requestable ? 600 : 400 }}>
                                    {e.requestable ? 'Yes' : 'No'}
                                  </span>
                                </label>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
