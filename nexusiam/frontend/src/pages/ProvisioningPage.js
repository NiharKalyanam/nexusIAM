import React, { useEffect, useMemo, useState } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { RefreshCw, Play, RotateCcw, PlusCircle } from 'lucide-react';

const OPS = [
  { value: 'create_account', label: 'Create Account' },
  { value: 'update_account', label: 'Update Account' },
  { value: 'disable_account', label: 'Disable Account' },
  { value: 'delete_account', label: 'Delete Account' },
  { value: 'enable_account', label: 'Enable Account' },
];

export default function ProvisioningPage() {
  const [transactions, setTransactions] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ connectorId: '', operation: 'create_account', payloadText: '{\n  "id": "2",\n  "email": "new.user@example.com",\n  "first_name": "New",\n  "last_name": "User",\n  "status": "Active"\n}' });

  const load = async () => {
    setLoading(true);
    try {
      const [tx, cs] = await Promise.all([
        API.get('/provisioning/transactions?limit=100'),
        API.get('/connectors')
      ]);
      setTransactions(tx.data || []);
      setConnectors(cs.data || []);
      if (!form.connectorId && cs.data?.length) setForm(f => ({ ...f, connectorId: cs.data[0].id }));
    } catch {
      toast.error('Failed to load provisioning data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const connectorName = useMemo(() => Object.fromEntries(connectors.map(c => [c.id, `${c.name} (${c.type})`])), [connectors]);

  const submitTransaction = async () => {
    try {
      const payload = form.mode === 'guided' ? form.guided : JSON.parse(form.payloadText || '{}');
      await API.post('/provisioning/transactions', {
        connectorId: form.connectorId,
        operation: form.operation,
        payload});
      toast.success('Provisioning transaction queued');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to queue provisioning');
    }
  };

  const executeTransaction = async (id, retry = false) => {
    try {
      await API.post(`/provisioning/transactions/${id}/${retry ? 'retry' : 'execute'}`);
      toast.success(retry ? 'Provisioning retried' : 'Provisioning executed');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Provisioning execution failed');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Provisioning Center</div>
          <div className="page-subtitle">Central queue for provisioning, deprovisioning, retries, and transaction history.</div>
        </div>
        <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>Queue Manual Provisioning</div>
          <div className="form-group">
            <label>Connector</label>
            <select value={form.connectorId} onChange={e => setForm({ ...form, connectorId: e.target.value })}>
              {connectors.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={form.operation} onChange={e => setForm({ ...form, operation: e.target.value })}>
              {OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Input Mode</label>
            <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}>
              <option value="guided">Guided form</option>
              <option value="json">Advanced JSON</option>
            </select>
          </div>
          {form.mode === 'guided' ? (
            <>
              <div className="grid-2">
                <div className="form-group"><label>Account ID</label><input value={form.guided.id} onChange={e => setForm({ ...form, guided: { ...form.guided, id: e.target.value } })} /></div>
                <div className="form-group"><label>Email</label><input value={form.guided.email} onChange={e => setForm({ ...form, guided: { ...form.guided, email: e.target.value } })} /></div>
              </div>
              <div className="grid-2">
                <div className="form-group"><label>First Name</label><input value={form.guided.first_name} onChange={e => setForm({ ...form, guided: { ...form.guided, first_name: e.target.value } })} /></div>
                <div className="form-group"><label>Last Name</label><input value={form.guided.last_name} onChange={e => setForm({ ...form, guided: { ...form.guided, last_name: e.target.value } })} /></div>
              </div>
              <div className="form-group"><label>Status</label><select value={form.guided.status} onChange={e => setForm({ ...form, guided: { ...form.guided, status: e.target.value } })}><option>Active</option><option>Inactive</option><option>Disabled</option></select></div>
            </>
          ) : (
            <div className="form-group">
              <label>Payload (JSON)</label>
              <textarea rows={12} value={form.payloadText} onChange={e => setForm({ ...form, payloadText: e.target.value })} />
            </div>
          )}
          <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
            Guided mode is recommended for day-to-day provisioning. Advanced JSON is only for custom test payloads. For JDBC connectors, configure SQL templates using values like <code>{'{{id}}'}</code>, <code>{'{{email}}'}</code>, <code>{'{{status}}'}</code> in create/update/disable SQL fields.
          </div>
          <button className="btn btn-primary" onClick={submitTransaction}><PlusCircle size={14} /> Queue Transaction</button>
        </div>

        <div className="card">
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>Transaction Monitor</div>
          {loading ? <div>Loading…</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Connector</th>
                    <th>Operation</th>
                    <th>Status</th>
                    <th>Target</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr><td colSpan="6" style={{ color: 'var(--text-secondary)' }}>No provisioning transactions yet.</td></tr>
                  ) : transactions.map(tx => (
                    <tr key={tx.id}>
                      <td>{new Date(tx.created_at).toLocaleString()}</td>
                      <td>{connectorName[tx.connector_id] || tx.connector_name || '—'}</td>
                      <td>{tx.operation}</td>
                      <td>{tx.status}</td>
                      <td>{tx.target_email || tx.target_username || 'ad hoc payload'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => executeTransaction(tx.id, false)}><Play size={12} /> Execute</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => executeTransaction(tx.id, true)}><RotateCcw size={12} /> Retry</button>
                        </div>
                        {tx.error_message && <div style={{ color: '#f87171', marginTop: 6 }}>{tx.error_message}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
