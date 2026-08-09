import Pagination from '../components/Pagination';
import React, { useState, useEffect } from 'react';
import { Search, RefreshCw, Download } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(15);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, page });
      if (search) params.set('action', search);
      const r = await API.get(`/audit?${params}`);
      setLogs(r.data.data);
      setTotal(r.data.total);
    } catch { toast.error('Failed to load audit logs'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchLogs(); }, [page]);

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Audit Trail</div><div className="page-subtitle">{total.toLocaleString()} total audit events</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={fetchLogs}><RefreshCw size={14} /></button>
          <button className="btn btn-secondary" onClick={() => toast('Export to CSV coming soon')}><Download size={14} /> Export</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div className="search-bar">
          <div className="search-input-wrap" style={{ flex: 1 }}>
            <Search size={14} className="search-icon" />
            <input placeholder="Filter by action..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchLogs()} />
          </div>
          <button className="btn btn-secondary" onClick={fetchLogs}>Apply</button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Action</th><th>User</th><th>Resource</th><th>Status</th><th>IP Address</th><th>Duration</th><th>Timestamp</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}><div className="loading-spinner" style={{ margin: 'auto' }} /></td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No audit events found</td></tr>
            ) : logs.map(l => (
              <tr key={l.id}>
                <td><span className="mono" style={{ color: '#06b6d4' }}>{l.action}</span></td>
                <td style={{ color: 'var(--text-secondary)' }}>{l.user_email || 'system'}</td>
                <td style={{ color: 'var(--text-muted)' }}>
                  {l.resource_type || '—'}{l.resource_id ? ` · ${l.resource_id.slice(0, 8)}…` : ''}
                </td>
                <td><span className={`badge badge-${l.status === 'success' ? 'success' : 'danger'}`}>{l.status}</span></td>
                <td><span className="mono" style={{ color: 'var(--text-muted)' }}>{l.ip_address || '—'}</span></td>
                <td style={{ color: 'var(--text-muted)' }}>{l.duration_ms ? `${l.duration_ms}ms` : '—'}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{new Date(l.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '12px 16px', borderTop: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>Page {page} — {total.toLocaleString()} total</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <Pagination page={page} total={total} limit={limit} onPageChange={setPage} onLimitChange={setLimit}/>
          </div>
        </div>
      </div>
    </div>
  );
}
