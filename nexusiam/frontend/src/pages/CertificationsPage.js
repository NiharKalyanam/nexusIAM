import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, CheckSquare } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

export default function CertificationsPage() {
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', type: 'user_access', due_date: '' });

  const fetchCerts = async () => {
    setLoading(true);
    try { const r = await API.get('/certifications'); setCerts(r.data); } catch { toast.error('Failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchCerts(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try { await API.post('/certifications', form); toast.success('Campaign created'); setShowCreate(false); fetchCerts(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const handleLaunch = async (id) => {
    try {
      const r = await API.post(`/certifications/${id}/launch`);
      toast.success(`Launched! ${r.data.itemsCreated} items created`);
      fetchCerts();
    } catch { toast.error('Launch failed'); }
  };

  const statusColor = { draft: 'gray', active: 'success', completed: 'info', cancelled: 'danger' };

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Access Certifications</div><div className="page-subtitle">Review & certify user access rights</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={fetchCerts}><RefreshCw size={14} /></button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14} /> New Campaign</button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Campaign</th><th>Type</th><th>Status</th><th>Progress</th><th>Due Date</th><th>Created</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}><div className="loading-spinner" style={{ margin: 'auto' }} /></td></tr>
            ) : certs.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No certification campaigns yet</td></tr>
            ) : certs.map(c => {
              const progress = c.total_items > 0 ? Math.round((c.decided_items / c.total_items) * 100) : 0;
              return (
                <tr key={c.id}>
                  <td><div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</div><div style={{ color: 'var(--text-muted)' }}>{c.description}</div></td>
                  <td><span className="badge badge-info">{c.type?.replace(/_/g, ' ')}</span></td>
                  <td><span className={`badge badge-${statusColor[c.status] || 'gray'}`}>{c.status}</span></td>
                  <td style={{ minWidth: 150 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${progress}%`, height: '100%', background: '#06b6d4', transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{c.decided_items || 0}/{c.total_items || 0}</span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{c.due_date}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td>
                    {c.status === 'draft' && <button className="btn btn-primary btn-sm" onClick={() => handleLaunch(c.id)}>Launch</button>}
                    {c.status === 'active' && <button className="btn btn-secondary btn-sm">Review Items</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>New Certification Campaign</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group"><label>Campaign Name *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
                <div className="form-group"><label>Description</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
                <div className="form-row form-row-2">
                  <div className="form-group"><label>Type</label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                      {['user_access', 'role_composition', 'entitlement', 'manager_review', 'application_access'].map(t =>
                        <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label>Due Date *</label>
                    <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} required />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Campaign</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
