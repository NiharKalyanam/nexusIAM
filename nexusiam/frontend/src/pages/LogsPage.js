import React, { useState, useEffect } from 'react';
import { RefreshCw, Download, CheckCircle } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

export default function LogsPage() {
  const [logEntries, setLogEntries] = useState([]);
  const [logFiles, setLogFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('stream');
  const [levelFilter, setLevelFilter] = useState('');
  const [lineCount, setLineCount] = useState(100);

  const fetchStream = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ lines: lineCount });
      if (levelFilter) params.set('level', levelFilter);
      const r = await API.get(`/logs/stream?${params}`);
      setLogEntries(r.data.entries || []);
    } catch {
      // If no log file exists yet, show empty
      setLogEntries([]);
    } finally { setLoading(false); }
  };

  const fetchFiles = async () => {
    setLoading(true);
    try { const r = await API.get('/logs'); setLogFiles(r.data.files || []); }
    catch { setLogFiles([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { tab === 'stream' ? fetchStream() : fetchFiles(); }, [tab, levelFilter, lineCount]);

  const handleValidate = async () => {
    if (!logEntries.length) return toast.error('No log entries to validate');
    try {
      const r = await API.post('/logs/validate', { entries: logEntries.slice(0, 20) });
      toast.success(`Validation: ${r.data.totalValid}/${Math.min(logEntries.length, 20)} valid entries`);
    } catch { toast.error('Validation failed'); }
  };

  const handleDownload = async (filename) => {
    try {
      const r = await API.get(`/logs/${filename}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Download failed'); }
  };

  const levelColor = { error: '#ef4444', warn: '#f59e0b', info: '#06b6d4', debug: 'var(--text-muted)', http: '#8b5cf6' };

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Application Logs</div><div className="page-subtitle">Real-time log streaming & validation — no server access needed</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={handleValidate}><CheckCircle size={14} /> Validate Logs</button>
          <button className="btn btn-secondary" onClick={() => tab === 'stream' ? fetchStream() : fetchFiles()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'stream' ? 'active' : ''}`} onClick={() => setTab('stream')}>Live Stream</button>
        <button className={`tab ${tab === 'files' ? 'active' : ''}`} onClick={() => setTab('files')}>Log Files</button>
      </div>

      {tab === 'stream' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={{ width: 140 }}>
              <option value="">All Levels</option>
              {['error', 'warn', 'info', 'debug', 'http'].map(l => <option key={l}>{l}</option>)}
            </select>
            <select value={lineCount} onChange={e => setLineCount(parseInt(e.target.value))} style={{ width: 120 }}>
              {[50, 100, 200, 500].map(n => <option key={n} value={n}>Last {n}</option>)}
            </select>
          </div>

          <div style={{ background: 'var(--bg-primary)', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', animation: 'pulse 2s infinite' }} />
              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>nexusiam.log — {logEntries.length} entries</span>
            </div>
            <div style={{ maxHeight: 500, overflowY: 'auto', padding: 16 }}>
              {loading ? (
                <div style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>Loading logs...</div>
              ) : logEntries.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>No log entries yet. Logs will appear here once the backend generates them.</div>
              ) : logEntries.map((entry, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 4, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>{entry.timestamp?.slice(0, 19) || '—'}</span>
                  <span style={{ color: levelColor[entry.level] || 'var(--text-secondary)', fontWeight: 600, width: 40, flexShrink: 0, textTransform: 'uppercase' }}>{entry.level?.slice(0, 4) || '—'}</span>
                  <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{entry.message || JSON.stringify(entry)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'files' && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>File Name</th><th>Size</th><th>Last Modified</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
                : logFiles.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No log files found</td></tr>
                : logFiles.map((f, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ color: '#06b6d4' }}>{f.name}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{(f.size / 1024).toFixed(1)} KB</td>
                    <td style={{ color: 'var(--text-muted)' }}>{new Date(f.modified).toLocaleString()}</td>
                    <td><button className="btn btn-secondary btn-sm" onClick={() => handleDownload(f.name)}><Download size={12} /> Download</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
