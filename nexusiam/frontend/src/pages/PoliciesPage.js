import React, { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, Plus } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

export default function PoliciesPage() {
  const [policies, setPolicies] = useState([]);
  const [violations, setViolations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('policies');
  const [scanning, setScanning] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', type: 'sod', enforcement: 'enforce' });

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [p, v] = await Promise.all([API.get('/policies'), API.get('/policies/violations')]);
      setPolicies(p.data); setViolations(v.data);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      const r = await API.post('/policies/scan');
      toast.success(`Scan complete: ${r.data.violationsFound} violations found`);
      fetchAll();
    } catch { toast.error('Scan failed'); }
    finally { setScanning(false); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try { await API.post('/policies', { ...form, rules: [] }); toast.success('Policy created'); setShowCreate(false); fetchAll(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Policies & SoD</div><div className="page-subtitle">Separation of Duties, MFA, Password & Access policies</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowCreate(true)}><Plus size={14} /> New Policy</button>
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            <AlertTriangle size={14} /> {scanning ? 'Scanning...' : 'Run SoD Scan'}
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'policies' ? 'active' : ''}`} onClick={() => setTab('policies')}>Policies ({policies.length})</button>
        <button className={`tab ${tab === 'violations' ? 'active' : ''}`} onClick={() => setTab('violations')}>Violations ({violations.length})</button>
      </div>

      {tab === 'policies' && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Policy</th><th>Type</th><th>Enforcement</th><th>Open Violations</th><th>Active</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr> :
                policies.map(p => (
                  <tr key={p.id}>
                    <td><div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{p.name}</div><div style={{ color: 'var(--text-muted)' }}>{p.description}</div></td>
                    <td><span className="badge badge-gray">{p.type}</span></td>
                    <td><span className={`badge badge-${p.enforcement === 'enforce' ? 'danger' : 'warning'}`}>{p.enforcement}</span></td>
                    <td>{p.violation_count > 0 ? <span style={{ color: '#ef4444', fontWeight: 700 }}>{p.violation_count}</span> : <span style={{ color: '#10b981' }}>0</span>}</td>
                    <td><span className={`badge badge-${p.is_active ? 'success' : 'gray'}`}>{p.is_active ? 'Active' : 'Disabled'}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'violations' && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>User</th><th>Policy</th><th>Violation Type</th><th>Severity</th><th>Status</th><th>Detected</th></tr></thead>
            <tbody>
              {violations.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#10b981' }}>✓ No open violations detected</td></tr>
              ) : violations.map(v => (
                <tr key={v.id}>
                  <td><div style={{ color: 'var(--text-primary)' }}>{v.user_name}</div><div style={{ color: 'var(--text-muted)' }}>{v.user_email}</div></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{v.policy_name}</td>
                  <td className="mono" style={{ color: '#f59e0b' }}>{v.violation_type}</td>
                  <td><span className={`badge badge-${v.severity === 'critical' ? 'danger' : v.severity === 'high' ? 'warning' : 'info'}`}>{v.severity}</span></td>
                  <td><span className={`badge badge-${v.status === 'open' ? 'danger' : 'success'}`}>{v.status}</span></td>
                  <td style={{ color: 'var(--text-muted)' }}>{new Date(v.detected_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Create Policy</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group"><label>Name *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
                <div className="form-group"><label>Description</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
                <div className="form-row form-row-2">
                  <div className="form-group"><label>Type</label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                      {['sod', 'password', 'mfa', 'session', 'access', 'data'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label>Enforcement</label>
                    <select value={form.enforcement} onChange={e => setForm({ ...form, enforcement: e.target.value })}>
                      <option value="enforce">Enforce</option>
                      <option value="detect">Detect Only</option>
                      <option value="report">Report Only</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Policy</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
