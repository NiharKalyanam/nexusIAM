import React, { useEffect, useMemo, useState } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { ShieldCheck, RefreshCw, Trash2 } from 'lucide-react';

export default function CapabilitiesPage() {
  const [caps, setCaps]       = useState([]);
  const [grants, setGrants]   = useState([]);
  const [users, setUsers]     = useState([]);
  const [form, setForm]       = useState({ user_id: '', capability_key: '' });
  const [selected, setSelected] = useState(new Set());
  const [deleteModal, setDeleteModal] = useState(false);
  const [justification, setJustification] = useState('');
  const [notifyEmail, setNotifyEmail]     = useState('');
  const [deleting, setDeleting]           = useState(false);

  const load = async () => {
    try {
      const [c, u] = await Promise.all([API.get('/capabilities'), API.get('/users')]);
      const userList = Array.isArray(u.data) ? u.data : (u.data?.data || []);
      setCaps(c.data.capabilities || []);
      setGrants(c.data.grants || []);
      setUsers(userList);
      setForm(f => ({
        user_id: f.user_id || userList?.[0]?.id || '',
        capability_key: f.capability_key || c.data?.capabilities?.[0]?.capability_key || ''}));
    } catch { toast.error('Failed to load capabilities'); }
  };

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() =>
    caps.reduce((acc, c) => { (acc[c.category] ||= []).push(c); return acc; }, {}),
    [caps]
  );

  const assign = async (e) => {
    e.preventDefault();
    if (!form.user_id || !form.capability_key) { toast.error('Select a user and capability'); return; }
    try {
      await API.post('/capabilities/assign', form);
      toast.success('Capability granted');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to assign'); }
  };

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const allSelected = grants.length > 0 && grants.every(g => selected.has(g.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(grants.map(g => g.id)));
  };

  const openDelete = () => {
    if (selected.size === 0) { toast.error('Select at least one grant to revoke'); return; }
    // Pre-fill email from first selected user
    const firstGrant = grants.find(g => selected.has(g.id));
    const user = users.find(u => u.id === firstGrant?.user_id);
    setNotifyEmail(user?.email || '');
    setJustification('');
    setDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!justification.trim()) { toast.error('Business justification is required'); return; }
    setDeleting(true);
    let ok = 0;
    for (const id of selected) {
      const grant = grants.find(g => g.id === id);
      if (!grant) continue;
      try {
        await API.delete('/capabilities/revoke', {
          data: { user_id: grant.user_id, capability_key: grant.capability_key, justification: justification.trim(), notify_email: notifyEmail }
        });
        ok++;
      } catch {}
    }
    setDeleting(false);
    toast.success(`${ok} capability grant${ok !== 1 ? 's' : ''} revoked`);
    setSelected(new Set());
    setDeleteModal(false);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Capabilities</div>
          <div className="page-subtitle">Shape the UI for a user by granting product capabilities</div>
        </div>
        <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 16, marginBottom: 16 }}>
        {/* Grant form */}
        <div className="card">
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Grant Capability</div>
          <form onSubmit={assign}>
            <div className="form-group">
              <label>User</label>
              <select value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })}>
                <option value="">— Select user —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} · {u.email}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Capability</label>
              <select value={form.capability_key} onChange={e => setForm({ ...form, capability_key: e.target.value })}>
                <option value="">— Select capability —</option>
                {caps.map(c => <option key={c.capability_key} value={c.capability_key}>{c.display_name} · {c.capability_key}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" type="submit"><ShieldCheck size={14} /> Grant</button>
          </form>
        </div>

        {/* Catalog */}
        <div className="card">
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Capability Catalog</div>
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 14 }}>
              <div style={{ color: '#06b6d4', fontWeight: 600, marginBottom: 8, textTransform: 'capitalize' }}>{cat}</div>
              {items.map(i => (
                <div key={i.capability_key} style={{ padding: '8px 0', borderTop: '1px solid #1e293b' }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{i.display_name}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{i.capability_key} · {i.description}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Grants table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            Direct Grants
            {selected.size > 0 && <span style={{ marginLeft: 8, color: 'var(--text-secondary)', fontWeight: 400 }}>{selected.size} selected</span>}
          </span>
          {selected.size > 0 && (
            <button className="btn btn-danger btn-sm" onClick={openDelete}>
              <Trash2 size={13} /> Revoke Selected ({selected.size})
            </button>
          )}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={grants.length === 0} />
              </th>
              <th>User</th>
              <th>Capability</th>
              <th>Grant Type</th>
              <th>Granted At</th>
            </tr>
          </thead>
          <tbody>
            {grants.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>No direct grants yet.</td></tr>
            )}
            {grants.map(g => (
              <tr key={g.id} style={{ background: selected.has(g.id) ? 'rgba(59,130,246,0.05)' : undefined }}>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleSelect(g.id)} />
                </td>
                <td style={{ color: 'var(--text-primary)' }}>{g.user_name || g.user_id}</td>
                <td>
                  <span style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', borderRadius: 4, padding: '2px 8px', fontFamily: 'monospace' }}>
                    {g.capability_key}
                  </span>
                </td>
                <td><span className="badge badge-gray">{g.grant_type}</span></td>
                <td style={{ color: 'var(--text-muted)' }}>{new Date(g.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete / Revoke modal */}
      {deleteModal && (
        <div className="modal-overlay" onClick={() => setDeleteModal(false)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: '#ef4444' }}>Revoke {selected.size} Capability Grant{selected.size !== 1 ? 's' : ''}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setDeleteModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: 12, marginBottom: 16, color: 'var(--text-secondary)' }}>
                The following grants will be permanently revoked:
                {grants.filter(g => selected.has(g.id)).map(g => (
                  <div key={g.id} style={{ marginTop: 6, color: 'var(--text-primary)' }}>
                    <span style={{ color: '#a78bfa', fontFamily: 'monospace' }}>{g.capability_key}</span>
                    <span style={{ color: 'var(--text-muted)' }}> from </span>
                    {g.user_name}
                  </div>
                ))}
              </div>
              <div className="form-group">
                <label>Business Justification <span style={{ color: '#ef4444' }}>*</span></label>
                <textarea rows={3} value={justification} onChange={e => setJustification(e.target.value)}
                  placeholder="Required for audit trail..." autoFocus />
              </div>
              <div className="form-group">
                <label>Notify Email <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input type="email" value={notifyEmail} onChange={e => setNotifyEmail(e.target.value)}
                  placeholder="user@company.com" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteModal(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete} disabled={deleting || !justification.trim()}>
                {deleting ? 'Revoking…' : `Revoke ${selected.size} Grant${selected.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
