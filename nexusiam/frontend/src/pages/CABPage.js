import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

export default function CABPage() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState({ title: '', description: '', type: 'change', risk_level: 'medium', planned_start: '', planned_end: '', implementation_plan: '', rollback_plan: '', impact_assessment: '' });

  const fetchCases = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const r = await API.get(`/cab?${params}`);
      setCases(r.data);
    } catch { toast.error('Failed to load CAB cases'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchCases(); }, [statusFilter]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try { await API.post('/cab', form); toast.success('CAB case created'); setShowCreate(false); fetchCases(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const handleStatus = async (id, status) => {
    try { await API.put(`/cab/${id}/status`, { status }); toast.success(`Updated to ${status}`); fetchCases(); }
    catch { toast.error('Failed to update status'); }
  };

  const statusColor = { draft: 'gray', submitted: 'info', under_review: 'warning', approved: 'success', rejected: 'danger', implemented: 'purple', closed: 'gray' };
  const riskColor = { critical: 'danger', high: 'warning', medium: 'info', low: 'success' };

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">CAB Cases</div><div className="page-subtitle">Change Advisory Board management</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 160 }}>
            <option value="">All Statuses</option>
            {['draft', 'submitted', 'under_review', 'approved', 'rejected', 'implemented', 'closed'].map(s =>
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={fetchCases}><RefreshCw size={14} /></button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14} /> New CAB Case</button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Case #</th><th>Title</th><th>Type</th><th>Risk</th><th>Status</th><th>Requester</th><th>Planned Start</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}><div className="loading-spinner" style={{ margin: 'auto' }} /></td></tr>
            ) : cases.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No CAB cases found</td></tr>
            ) : cases.map(c => (
              <tr key={c.id}>
                <td><span className="mono" style={{ color: '#06b6d4' }}>{c.case_number}</span></td>
                <td style={{ maxWidth: 200 }}><div style={{ fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div></td>
                <td><span className="badge badge-gray">{c.type?.replace(/_/g, ' ')}</span></td>
                <td><span className={`badge badge-${riskColor[c.risk_level] || 'gray'}`}>{c.risk_level}</span></td>
                <td><span className={`badge badge-${statusColor[c.status] || 'gray'}`}>{c.status?.replace(/_/g, ' ')}</span></td>
                <td style={{ color: 'var(--text-secondary)' }}>{c.requester_name || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{c.planned_start ? new Date(c.planned_start).toLocaleDateString() : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {c.status === 'draft' && <button className="btn btn-secondary btn-sm" onClick={() => handleStatus(c.id, 'submitted')}>Submit</button>}
                    {c.status === 'submitted' && <button className="btn btn-secondary btn-sm" onClick={() => handleStatus(c.id, 'approved')}>Approve</button>}
                    {c.status === 'approved' && <button className="btn btn-primary btn-sm" onClick={() => handleStatus(c.id, 'implemented')}>Mark Implemented</button>}
                    {c.status === 'implemented' && <button className="btn btn-secondary btn-sm" onClick={() => handleStatus(c.id, 'closed')}>Close</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>New CAB Case</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group"><label>Title *</label><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required /></div>
                <div className="form-group"><label>Description</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} /></div>
                <div className="form-row form-row-2">
                  <div className="form-group"><label>Change Type</label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                      {['change', 'emergency_change', 'standard_change', 'major_change'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label>Risk Level</label>
                    <select value={form.risk_level} onChange={e => setForm({ ...form, risk_level: e.target.value })}>
                      {['low', 'medium', 'high', 'critical'].map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row form-row-2">
                  <div className="form-group"><label>Planned Start</label><input type="datetime-local" value={form.planned_start} onChange={e => setForm({ ...form, planned_start: e.target.value })} /></div>
                  <div className="form-group"><label>Planned End</label><input type="datetime-local" value={form.planned_end} onChange={e => setForm({ ...form, planned_end: e.target.value })} /></div>
                </div>
                <div className="form-group"><label>Implementation Plan</label><textarea value={form.implementation_plan} onChange={e => setForm({ ...form, implementation_plan: e.target.value })} rows={3} /></div>
                <div className="form-group"><label>Rollback Plan</label><textarea value={form.rollback_plan} onChange={e => setForm({ ...form, rollback_plan: e.target.value })} rows={2} /></div>
                <div className="form-group"><label>Impact Assessment</label><textarea value={form.impact_assessment} onChange={e => setForm({ ...form, impact_assessment: e.target.value })} rows={2} /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create CAB Case</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
