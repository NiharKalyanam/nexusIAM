import Pagination from '../components/Pagination';
import React, { useState, useEffect, useCallback } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import OwnerPicker from '../components/OwnerPicker';
import { CAPABILITIES } from '../constants/capabilities';



const NOTIFICATION_OPTIONS = [
  { value: 'members_and_email', label: 'Notify members and group email' },
  { value: 'members_only',      label: 'Notify members only' },
  { value: 'email_only',        label: 'Notify group email only' },
];

const EMPTY_FORM = {
  name: '', description: '', owner: null,
  group_email: '', notification_setting: 'members_and_email',
  capabilities: [],
};

export default function WorkgroupsPage() {
  const [workgroups, setWorkgroups]     = useState([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [search, setSearch]             = useState('');
  const [loading, setLoading]           = useState(false);
  const [modalOpen, setModalOpen]       = useState(false);
  const [editTarget, setEditTarget]     = useState(null); // null = create
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [detailWg, setDetailWg]         = useState(null); // full workgroup with members
  const [detailOpen, setDetailOpen]     = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [addMemberResults, setAddMemberResults] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [limit, setLimit] = useState(15);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get('/workgroups', { params: { search, page, limit } });
      setWorkgroups(data.data || []);
      setTotal(data.pagination?.total || 0);
    } catch { toast.error('Failed to load workgroups'); }
    setLoading(false);
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  // ── Open create modal ───────────────────────────────────────────────────────
  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  // ── Open edit modal ─────────────────────────────────────────────────────────
  const openEdit = (wg) => {
    setEditTarget(wg);
    setForm({
      name: wg.name,
      description: wg.description || '',
      owner: wg.owner_id ? { id: wg.owner_id, name: wg.owner_name, type: 'identity' } : null,
      group_email: wg.group_email || '',
      notification_setting: wg.notification_setting || 'members_and_email',
      capabilities: wg.capabilities || []});
    setModalOpen(true);
  };

  // ── Save workgroup ──────────────────────────────────────────────────────────
  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        owner_id: form.owner?.id || null,
        group_email: form.group_email || null,
        notification_setting: form.notification_setting,
        capabilities: form.capabilities,
      };
      if (editTarget) {
        await API.put(`/workgroups/${editTarget.id}`, payload);
        toast.success('Workgroup updated');
      } else {
        await API.post('/workgroups', payload);
        toast.success('Workgroup created');
      }
      setModalOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
    setSaving(false);
  };

  // ── Open detail (members management) ───────────────────────────────────────
  const openDetail = async (wg) => {
    try {
      const { data } = await API.get(`/workgroups/${wg.id}`);
      setDetailWg(data);
      setSelectedMembers([]);
      setAddMemberSearch('');
      setAddMemberResults([]);
      setDetailOpen(true);
    } catch { toast.error('Failed to load workgroup details'); }
  };

  // ── Search users to add as members ─────────────────────────────────────────
  useEffect(() => {
    if (!addMemberSearch) { setAddMemberResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const { data } = await API.get('/workgroups/picker/search', {
          params: { q: addMemberSearch, limit: 10 }
        });
        // Only identities, not workgroups
        setAddMemberResults((data.results || []).filter(r => r.type === 'identity'));
      } catch { setAddMemberResults([]); }
    }, 250);
    return () => clearTimeout(timer);
  }, [addMemberSearch]);

  const addMember = async (user) => {
    try {
      await API.post(`/workgroups/${detailWg.id}/members`, { user_id: user.id });
      toast.success(`${user.first_name} ${user.last_name} added`);
      const { data } = await API.get(`/workgroups/${detailWg.id}`);
      setDetailWg(data);
      setAddMemberSearch('');
      setAddMemberResults([]);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to add member'); }
  };

  const removeMembers = async () => {
    if (!selectedMembers.length) { toast.error('Select members to remove'); return; }
    try {
      await API.delete(`/workgroups/${detailWg.id}/members`, { data: { user_ids: selectedMembers } });
      toast.success(`${selectedMembers.length} member(s) removed`);
      const { data } = await API.get(`/workgroups/${detailWg.id}`);
      setDetailWg(data);
      setSelectedMembers([]);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to remove members'); }
  };

  const toggleCap = (key) => {
    setForm(f => ({
      ...f,
      capabilities: f.capabilities.includes(key)
        ? f.capabilities.filter(c => c !== key)
        : [...f.capabilities, key]}));
  };

  const deleteWorkgroup = async (wg) => {
    try {
      await API.delete(`/workgroups/${wg.id}`);
      toast.success('Workgroup deleted');
      setDeleteConfirm(null);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
  };

  const pages = Math.ceil(total / limit);

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">Workgroups</div>
          <div className="page-subtitle">{total} workgroup{total !== 1 ? 's' : ''} · Manage group memberships and capabilities</div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ Create Workgroup</button>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
        <input
          className="form-control"
          placeholder="Filter workgroups by name…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 320 }}
        />
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid #1e2a3a' }}>
              {['Name', 'Description', 'Owner', 'Members', 'Capabilities', 'Modified', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            )}
            {!loading && !workgroups.length && (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                No workgroups found. <button className="btn btn-primary btn-sm" onClick={openCreate} style={{ marginLeft: 8 }}>Create one</button>
              </td></tr>
            )}
            {workgroups.map(wg => (
              <tr key={wg.id} style={{ borderBottom: '1px solid #1e2a3a' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <td style={{ padding: '11px 14px' }}>
                  <button onClick={() => openDetail(wg)}
                    style={{ background: 'none', border: 'none', color: '#38bdf8', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                    👥 {wg.name}
                  </button>
                </td>
                <td style={{ padding: '11px 14px', color: 'var(--text-secondary)' }}>{wg.description || '—'}</td>
                <td style={{ padding: '11px 14px', color: 'var(--border-bright)' }}>{wg.owner_name || '—'}</td>
                <td style={{ padding: '11px 14px' }}>
                  <span style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', borderRadius: 12, padding: '2px 10px' }}>
                    {wg.member_count}
                  </span>
                </td>
                <td style={{ padding: '11px 14px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(wg.capabilities || []).slice(0, 3).map(cap => {
                      const c = CAPABILITIES.find(x => x.key === cap);
                      return (
                        <span key={cap} style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', borderRadius: 4, padding: '2px 7px' }}>
                          {c?.label || cap}
                        </span>
                      );
                    })}
                    {(wg.capabilities || []).length > 3 && (
                      <span style={{ color: 'var(--text-muted)' }}>+{wg.capabilities.length - 3} more</span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '11px 14px', color: 'var(--text-muted)' }}>
                  {wg.updated_at ? new Date(wg.updated_at).toLocaleDateString() : '—'}
                </td>
                <td style={{ padding: '11px 14px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(wg)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(wg)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pages > 1 && (
          <div style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid #1e2a3a' }}>
            <Pagination page={page} total={total} limit={limit} onPageChange={setPage} onLimitChange={(l)=>{setLimit(l);setPage(1)}}/>
          </div>
        )}
      </div>

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 680, width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                {editTarget ? 'Edit Workgroup' : 'Create Workgroup'}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setModalOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', maxHeight: '75vh' }}>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>* Indicates required field</div>

              {/* Name */}
              <div className="form-group">
                <label>Name *</label>
                <input className="form-control" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. IAM Admins" />
              </div>

              {/* Owner */}
              <div className="form-group">
                <label>Owner</label>
                <OwnerPicker
                  value={form.owner}
                  onChange={owner => setForm(f => ({ ...f, owner }))}
                  placeholder="Select owner identity or workgroup…"
                />
              </div>

              {/* Description */}
              <div className="form-group">
                <label>Description</label>
                <textarea className="form-control" rows={3} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the purpose of this workgroup…" />
              </div>

              {/* Group Email + Notification */}
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label>Group Email</label>
                  <input className="form-control" type="email" value={form.group_email}
                    onChange={e => setForm(f => ({ ...f, group_email: e.target.value }))}
                    placeholder="iam-admins@company.com" />
                </div>
                <div className="form-group">
                  <label>Notification Setting</label>
                  <select className="form-control" value={form.notification_setting}
                    onChange={e => setForm(f => ({ ...f, notification_setting: e.target.value }))}>
                    {NOTIFICATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Capabilities */}
              <div className="form-group">
                <label style={{ marginBottom: 10 }}>Capabilities</label>
                <div style={{ background: 'var(--bg-primary)', border: '1px solid #1e2a3a', borderRadius: 8, padding: 4 }}>
                  {CAPABILITIES.map(cap => (
                    <label key={cap.key}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', borderRadius: 6,
                               background: form.capabilities.includes(cap.key) ? 'rgba(139,92,246,0.08)' : 'transparent',
                               border: '1px solid ' + (form.capabilities.includes(cap.key) ? 'rgba(139,92,246,0.2)' : 'transparent') }}
                      onMouseEnter={e => { if (!form.capabilities.includes(cap.key)) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                      onMouseLeave={e => { if (!form.capabilities.includes(cap.key)) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <input type="checkbox" checked={form.capabilities.includes(cap.key)}
                        onChange={() => toggleCap(cap.key)}
                        style={{ width: 16, height: 16, accentColor: '#8b5cf6', flexShrink: 0, cursor: 'pointer' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ color: form.capabilities.includes(cap.key) ? '#a78bfa' : 'var(--text-secondary)', fontWeight: 500 }}>
                          {cap.label}
                        </div>
                        <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{cap.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Workgroup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail / Members Modal ──────────────────────────────────────────── */}
      {detailOpen && detailWg && (
        <div className="modal-overlay" onClick={() => setDetailOpen(false)}>
          <div className="modal" style={{ maxWidth: 760, width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>👥 {detailWg.name}</span>
                {detailWg.description && (
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{detailWg.description}</div>
                )}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setDetailOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', maxHeight: '75vh' }}>

              {/* Capabilities summary */}
              {detailWg.capabilities?.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Capabilities</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {detailWg.capabilities.map(cap => {
                      const c = CAPABILITIES.find(x => x.key === cap);
                      return (
                        <span key={cap} style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', borderRadius: 6, padding: '4px 10px', border: '1px solid rgba(139,92,246,0.2)' }}>
                          {c?.label || cap}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Add member search */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Add Member</div>
                <div style={{ position: 'relative' }}>
                  <input
                    className="form-control"
                    placeholder="Search by name or email…"
                    value={addMemberSearch}
                    onChange={e => setAddMemberSearch(e.target.value)}
                  />
                  {addMemberResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-tertiary)', border: '1px solid #2a3545', borderRadius: 8, zIndex: 100, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                      {addMemberResults.map(u => {
                        const alreadyMember = (detailWg.members || []).some(m => m.id === u.id);
                        return (
                          <div key={u.id}
                            style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                     opacity: alreadyMember ? 0.5 : 1 }}
                          >
                            <div>
                              <div style={{ color: 'var(--text-secondary)' }}>{u.first_name} {u.last_name}</div>
                              <div style={{ color: 'var(--text-muted)' }}>{u.email}</div>
                            </div>
                            {alreadyMember
                              ? <span style={{ color: 'var(--text-secondary)' }}>Already member</span>
                              : <button className="btn btn-primary btn-sm" onClick={() => addMember(u)}>Add Member</button>
                            }
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Members table */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Members ({(detailWg.members || []).length})
                </div>
                {selectedMembers.length > 0 && (
                  <button className="btn btn-danger btn-sm" onClick={removeMembers}>
                    Remove Selected ({selectedMembers.length})
                  </button>
                )}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid #1e2a3a' }}>
                    <th style={{ padding: '8px 12px', width: 32 }}>
                      <input type="checkbox"
                        checked={selectedMembers.length === (detailWg.members || []).length && selectedMembers.length > 0}
                        onChange={e => setSelectedMembers(e.target.checked ? (detailWg.members || []).map(m => m.id) : [])}
                      />
                    </th>
                    {['Name', 'First Name', 'Last Name', 'Email', 'Employee ID', 'Added'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!(detailWg.members || []).length && (
                    <tr><td colSpan={7} style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)' }}>No members yet</td></tr>
                  )}
                  {(detailWg.members || []).map(m => (
                    <tr key={m.id} style={{ borderBottom: '1px solid #1e2a3a' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="checkbox"
                          checked={selectedMembers.includes(m.id)}
                          onChange={e => setSelectedMembers(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))}
                        />
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>{m.username}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--border-bright)' }}>{m.first_name}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--border-bright)' }}>{m.last_name}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{m.email}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{m.employee_id || '—'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                        {m.added_at ? new Date(m.added_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => openEdit(detailWg)}>Edit Workgroup</button>
              <button className="btn btn-primary" onClick={() => setDetailOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ──────────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ color: '#ef4444', fontWeight: 700 }}>Delete Workgroup</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--border-bright)' }}>
                Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>{deleteConfirm.name}</strong>?
                This will remove all {deleteConfirm.member_count} member(s) from the workgroup.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteWorkgroup(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
