import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Package, ToggleLeft, ToggleRight } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

export default function PluginsPage() {
  const [plugins, setPlugins] = useState([]);
  const [loggers, setLoggers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('plugins');
  const [showLoggerForm, setShowLoggerForm] = useState(false);
  const [loggerForm, setLoggerForm] = useState({ name: '', logger_class: '', log_level: 'INFO' });

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [p, l] = await Promise.all([API.get('/plugins'), API.get('/plugins/loggers')]);
      setPlugins(p.data); setLoggers(l.data);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  const handleToggle = async (id) => {
    try { await API.post(`/plugins/${id}/toggle`); fetchAll(); }
    catch { toast.error('Failed to toggle'); }
  };

  const handleAddLogger = async (e) => {
    e.preventDefault();
    try { await API.post('/plugins/loggers', loggerForm); toast.success('Logger added'); setShowLoggerForm(false); fetchAll(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const levelColor = { DEBUG: 'info', INFO: 'success', WARN: 'warning', ERROR: 'danger' };
  const typeColor = { connector: 'cyan', workflow: 'purple', validator: 'warning', transformer: 'info', notifier: 'success', reporter: 'gray' };

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Plugins & Loggers</div><div className="page-subtitle">Extend NexusIAM with custom code — no restrictions</div></div>
      </div>

      <div style={{ padding: 16, background: 'rgba(139,92,246,0.05)', borderRadius: 8, border: '1px solid rgba(139,92,246,0.2)', marginBottom: 16, color: 'var(--text-secondary)' }}>
        🔧 <strong style={{ color: '#8b5cf6' }}>Developer Freedom:</strong> Upload JAR/ZIP plugins, define custom loggers with your own logger class, configure log validation — full extensibility without server access.
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'plugins' ? 'active' : ''}`} onClick={() => setTab('plugins')}>Plugins ({plugins.length})</button>
        <button className={`tab ${tab === 'loggers' ? 'active' : ''}`} onClick={() => setTab('loggers')}>Custom Loggers ({loggers.length})</button>
      </div>

      {tab === 'plugins' && (
        <>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Plugin</th><th>Type</th><th>Version</th><th>Entry Class</th><th>Status</th><th>Last Run</th><th>Toggle</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}><div className="loading-spinner" style={{ margin: 'auto' }} /></td></tr>
                  : plugins.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No plugins installed. Upload a JAR or ZIP plugin to get started.
                    </td></tr>
                  ) : plugins.map(p => (
                    <tr key={p.id}>
                      <td><div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{p.name}</div><div style={{ color: 'var(--text-muted)' }}>{p.file_path}</div></td>
                      <td><span className={`badge badge-${typeColor[p.type] || 'gray'}`}>{p.type}</span></td>
                      <td className="mono" style={{ }}>{p.version || '—'}</td>
                      <td className="mono" style={{ color: 'var(--text-muted)' }}>{p.entry_class || '—'}</td>
                      <td><span className={`badge badge-${p.status === 'active' ? 'success' : p.status === 'error' ? 'danger' : 'gray'}`}>{p.status}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.last_executed ? new Date(p.last_executed).toLocaleString() : 'Never'}</td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleToggle(p.id)}>
                          {p.status === 'active' ? <ToggleRight size={14} color="#06b6d4" /> : <ToggleLeft size={14} />}
                          {p.status === 'active' ? ' Disable' : ' Enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'loggers' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-primary" onClick={() => setShowLoggerForm(true)}><Plus size={14} /> Add Custom Logger</button>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Logger Name</th><th>Logger Class</th><th>Level</th><th>Status</th></tr></thead>
              <tbody>
                {loggers.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    No custom loggers. Add your own logger class (e.g. Splunk, ELK, custom appender).
                  </td></tr>
                ) : loggers.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{l.name}</td>
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>{l.logger_class || '—'}</td>
                    <td><span className={`badge badge-${levelColor[l.log_level] || 'gray'}`}>{l.log_level}</span></td>
                    <td><span className={`badge badge-${l.enabled ? 'success' : 'gray'}`}>{l.enabled ? 'Enabled' : 'Disabled'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showLoggerForm && (
            <div className="modal-overlay" onClick={() => setShowLoggerForm(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Add Custom Logger</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowLoggerForm(false)}>×</button>
                </div>
                <form onSubmit={handleAddLogger}>
                  <div className="modal-body">
                    <div className="form-group"><label>Logger Name *</label><input value={loggerForm.name} onChange={e => setLoggerForm({ ...loggerForm, name: e.target.value })} required /></div>
                    <div className="form-group"><label>Logger Class (optional)</label><input value={loggerForm.logger_class} onChange={e => setLoggerForm({ ...loggerForm, logger_class: e.target.value })} placeholder="com.mycompany.logging.MyAppender" className="mono" /></div>
                    <div className="form-group"><label>Log Level</label>
                      <select value={loggerForm.log_level} onChange={e => setLoggerForm({ ...loggerForm, log_level: e.target.value })}>
                        {['DEBUG', 'INFO', 'WARN', 'ERROR'].map(l => <option key={l}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowLoggerForm(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Add Logger</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
