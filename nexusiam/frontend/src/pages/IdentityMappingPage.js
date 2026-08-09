import React, { useState, useEffect, useCallback } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const ATTR_TYPES = ['string', 'boolean', 'date', 'integer', 'multi_string'];
const EDIT_MODES = ['editable', 'read_only'];
const TRANSFORM_OPTIONS = [
  { value: '', label: '— No transformation —' },
  { value: 'upper', label: 'Uppercase' },
  { value: 'lower', label: 'Lowercase' },
  { value: 'trim', label: 'Trim whitespace' },
  { value: 'concat_name', label: 'Concat first + last name' },
  { value: 'date_format', label: 'Date format (ISO → local)' },
];

export default function IdentityMappingPage() {
  const navigate = useNavigate();
  const [attributes, setAttributes] = useState([]);
  const [apps, setApps] = useState([]);
  const [appSchemas, setAppSchemas] = useState({}); // appId -> [attr names]
  const [loading, setLoading] = useState(false);
  const [editAttr, setEditAttr] = useState(null);  // attribute being edited
  const [editForm, setEditForm] = useState({});
  const [sources, setSources] = useState([]);       // source mappings for editAttr
  const [targets, setTargets] = useState([]);       // target mappings for editAttr
  const [saving, setSaving] = useState(false);
  const [addAttrOpen, setAddAttrOpen] = useState(false);
  const [newAttr, setNewAttr] = useState({ attribute_name: '', display_name: '', attribute_type: 'string' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [attrsRes, appsRes] = await Promise.all([
        API.get('/identity-mapping/attributes'),
        API.get('/applications', { params: { limit: 200 } }),
      ]);
      setAttributes(attrsRes.data.data || []);
      setApps(Array.isArray(appsRes.data) ? appsRes.data : (appsRes.data.data || appsRes.data.applications || []));
    } catch { toast.error('Failed to load identity mapping'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (attr) => {
    setEditAttr(attr);
    setEditForm({
      display_name: attr.display_name || '',
      attribute_type: attr.attribute_type || 'string',
      edit_mode: attr.edit_mode || 'editable',
      is_multi_valued: !!attr.is_multi_valued});
    setSources(attr.source_mappings ? attr.source_mappings.map(s => ({ ...s })) : []);
    setTargets(attr.target_mappings ? attr.target_mappings.map(t => ({ ...t })) : []);
  };

  const closeEdit = () => { setEditAttr(null); setSources([]); setTargets([]); };

  const saveAttr = async () => {
    setSaving(true);
    try {
      // Save attr metadata
      await API.put(`/identity-mapping/attributes/${editAttr.id}`, editForm);
      // Save sources
      await API.put(`/identity-mapping/attributes/${editAttr.id}/sources`, {
        sources: sources.filter(s => s.source_attribute?.trim())});
      // Save targets
      await API.put(`/identity-mapping/attributes/${editAttr.id}/targets`, {
        targets: targets.filter(t => t.target_application_id && t.target_attribute?.trim())});
      toast.success('Identity attribute saved');
      closeEdit();
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    setSaving(false);
  };

  const createAttr = async () => {
    if (!newAttr.attribute_name.trim()) { toast.error('Attribute name is required'); return; }
    try {
      await API.post('/identity-mapping/attributes', {
        ...newAttr,
        display_name: newAttr.display_name || newAttr.attribute_name});
      toast.success('Attribute created');
      setAddAttrOpen(false);
      setNewAttr({ attribute_name: '', display_name: '', attribute_type: 'string' });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Create failed'); }
  };

  const deleteAttr = async (attr) => {
    if (attr.is_system) { toast.error('System attributes cannot be deleted'); return; }
    if (!window.confirm(`Delete attribute "${attr.display_name}"?`)) return;
    try {
      await API.delete(`/identity-mapping/attributes/${attr.id}`);
      toast.success('Attribute deleted');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
  };

  // Source mapping helpers
  const loadAppSchema = async (appId) => {
    if (!appId || appSchemas[appId]) return;
    try {
      const { data } = await API.get(`/applications/${appId}/schema`);
      const attrs = (data.schema || []).map(f => f.name || f.attribute || f).filter(Boolean);
      setAppSchemas(prev => ({ ...prev, [appId]: attrs }));
    } catch { setAppSchemas(prev => ({ ...prev, [appId]: [] })); }
  };

  const addSource = () => setSources(s => [...s, { source_application_id: '', source_attribute: '', priority: s.length + 1 }]);
  const removeSource = (i) => setSources(s => s.filter((_, idx) => idx !== i));
  const moveSource = (i, dir) => {
    setSources(s => {
      const arr = [...s];
      const swap = i + dir;
      if (swap < 0 || swap >= arr.length) return arr;
      [arr[i], arr[swap]] = [arr[swap], arr[i]];
      return arr;
    });
  };

  // Target mapping helpers
  const addTarget = () => setTargets(t => [...t, { target_application_id: '', target_attribute: '', transformation_rule: '', provision_all_accounts: false }]);
  const removeTarget = (i) => setTargets(t => t.filter((_, idx) => idx !== i));

  const getPrimarySourceLabel = (attr) => {
    const srcs = attr.source_mappings || [];
    if (!srcs.length) return null;
    const s = srcs[0];
    return `${s.source_attribute} from ${s.app_name || 'Unknown app'}`;
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => navigate('/settings')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              ← Global Settings
            </button>
          </div>
          <div className="page-title" style={{ marginTop: 4 }}>Identity Mapping</div>
          <div className="page-subtitle">
            {attributes.length} attribute{attributes.length !== 1 ? 's' : ''} · Define how identity data is sourced and distributed
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setAddAttrOpen(true)}>+ Add New Attribute</button>
      </div>

      {/* Attributes table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid #1e2a3a' }}>
              {['Attribute', 'Display Name', 'Type', 'Primary Source Mapping', 'Targets', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            )}
            {attributes.map(attr => {
              const primarySrc = getPrimarySourceLabel(attr);
              const targetCount = (attr.target_mappings || []).length;
              return (
                <tr key={attr.id} style={{ borderBottom: '1px solid #1e2a3a' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'monospace' }}>
                        {attr.attribute_name}
                      </span>
                      {attr.is_system && (
                        <span style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', padding: '1px 6px', borderRadius: 4 }}>system</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--border-bright)' }}>{attr.display_name}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399', padding: '2px 8px', borderRadius: 4 }}>
                      {attr.attribute_type}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                    {primarySrc || <span style={{ color: 'var(--text-secondary)' }}>Not configured</span>}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {targetCount > 0
                      ? <span style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', padding: '2px 8px', borderRadius: 4 }}>{targetCount} target{targetCount !== 1 ? 's' : ''}</span>
                      : <span style={{ color: 'var(--text-secondary)' }}>—</span>
                    }
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(attr)}>Edit</button>
                      {!attr.is_system && (
                        <button className="btn btn-danger btn-sm" onClick={() => deleteAttr(attr)}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Edit Attribute Modal ──────────────────────────────────────────────── */}
      {editAttr && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal" style={{ maxWidth: 760, width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                Edit Identity Attribute — <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>{editAttr.attribute_name}</span>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={closeEdit}>×</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', maxHeight: '75vh' }}>

              {/* Identity Attribute section */}
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Identity Attribute</div>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label>Attribute Name</label>
                    <input className="form-control" value={editAttr.attribute_name} disabled style={{ opacity: 0.6, fontFamily: 'monospace' }} />
                  </div>
                  <div className="form-group">
                    <label>Display Name</label>
                    <input className="form-control" value={editForm.display_name}
                      onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))} />
                  </div>
                </div>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label>Attribute Type</label>
                    <select className="form-control" value={editForm.attribute_type}
                      onChange={e => setEditForm(f => ({ ...f, attribute_type: e.target.value }))}>
                      {ATTR_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Edit Mode</label>
                    <select className="form-control" value={editForm.edit_mode}
                      onChange={e => setEditForm(f => ({ ...f, edit_mode: e.target.value }))}>
                      {EDIT_MODES.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--border-bright)' }}>
                  <input type="checkbox" checked={editForm.is_multi_valued}
                    onChange={e => setEditForm(f => ({ ...f, is_multi_valued: e.target.checked }))}
                    style={{ accentColor: '#3b82f6' }} />
                  Multi-Valued
                </label>
              </div>

              {/* Source Mappings */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ color: '#38bdf8', fontWeight: 600 }}>Source Mappings</div>
                  <button className="btn btn-secondary btn-sm" onClick={addSource}>+ Add Source</button>
                </div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 10 }}>
                  Priority order — source 1 wins. Falls back to source 2, 3 etc if value is empty.
                </div>
                {sources.length === 0 && (
                  <div style={{ color: 'var(--text-secondary)', padding: '12px 0' }}>No source mappings configured. Click Add Source to begin.</div>
                )}
                {sources.map((src, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, background: 'var(--bg-tertiary)', padding: 10, borderRadius: 8 }}>
                    <div style={{ color: '#8b5cf6', fontWeight: 700, minWidth: 20 }}>{i + 1}.</div>
                    <select className="form-control" value={src.source_application_id || ''}
                      onChange={e => {
                        const appId = e.target.value;
                        setSources(s => s.map((x, idx) => idx === i ? { ...x, source_application_id: appId, source_attribute: '' } : x));
                        loadAppSchema(appId);
                      }}
                      style={{ flex: 2 }}>
                      <option value="">— Select Application —</option>
                      {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <div style={{ flex: 2 }}>
                      {appSchemas[src.source_application_id]?.length > 0 ? (
                        <select className="form-control"
                          value={src.source_attribute || ''}
                          onChange={e => setSources(s => s.map((x, idx) => idx === i ? { ...x, source_attribute: e.target.value } : x))}>
                          <option value="">— Select attribute —</option>
                          {(appSchemas[src.source_application_id] || []).map(attr => (
                            <option key={attr} value={attr}>{attr}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="form-control" placeholder={src.source_application_id ? 'Loading schema…' : 'Select app first'}
                          value={src.source_attribute || ''}
                          onChange={e => setSources(s => s.map((x, idx) => idx === i ? { ...x, source_attribute: e.target.value } : x))} />
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => moveSource(i, -1)} disabled={i === 0}
                        style={{ background: 'none', border: '1px solid #2a3545', borderRadius: 4, color: 'var(--text-muted)', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↑</button>
                      <button onClick={() => moveSource(i, 1)} disabled={i === sources.length - 1}
                        style={{ background: 'none', border: '1px solid #2a3545', borderRadius: 4, color: 'var(--text-muted)', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↓</button>
                      <button onClick={() => removeSource(i)}
                        style={{ background: 'none', border: '1px solid #ef444430', borderRadius: 4, color: '#ef4444', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Target Mappings */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ color: '#38bdf8', fontWeight: 600 }}>Target Mappings</div>
                  <button className="btn btn-secondary btn-sm" onClick={addTarget}>+ Add Target</button>
                </div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 10 }}>
                  Define which target applications receive this attribute during attribute sync.
                </div>
                {targets.length === 0 && (
                  <div style={{ color: 'var(--text-secondary)', padding: '12px 0' }}>No target mappings configured.</div>
                )}
                {targets.length > 0 && (
                  <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #1e2a3a' }}>
                          {['Application', 'Attribute', 'Transformation', 'Provision All', ''].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {targets.map((tgt, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #1e2a3a' }}>
                            <td style={{ padding: '8px 8px' }}>
                              <select className="form-control" value={tgt.target_application_id || ''}
                                onChange={e => setTargets(t => t.map((x, idx) => idx === i ? { ...x, target_application_id: e.target.value } : x))}>
                                <option value="">— Select App —</option>
                                {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '8px 8px' }}>
                              <input className="form-control" placeholder="e.g. firstName"
                                value={tgt.target_attribute || ''}
                                onChange={e => setTargets(t => t.map((x, idx) => idx === i ? { ...x, target_attribute: e.target.value } : x))} />
                            </td>
                            <td style={{ padding: '8px 8px' }}>
                              <select className="form-control" value={tgt.transformation_rule || ''}
                                onChange={e => setTargets(t => t.map((x, idx) => idx === i ? { ...x, transformation_rule: e.target.value } : x))}>
                                {TRANSFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                              <input type="checkbox" checked={!!tgt.provision_all_accounts}
                                onChange={e => setTargets(t => t.map((x, idx) => idx === i ? { ...x, provision_all_accounts: e.target.checked } : x))}
                                style={{ accentColor: '#3b82f6' }} />
                            </td>
                            <td style={{ padding: '8px 8px' }}>
                              <button onClick={() => removeTarget(i)}
                                style={{ background: 'none', border: '1px solid #ef444430', borderRadius: 4, color: '#ef4444', width: 28, height: 28, cursor: 'pointer' }}>×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeEdit}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAttr} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Attribute Modal ───────────────────────────────────────────────── */}
      {addAttrOpen && (
        <div className="modal-overlay" onClick={() => setAddAttrOpen(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Add New Attribute</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setAddAttrOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Attribute Name * <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(internal, no spaces)</span></label>
                <input className="form-control" placeholder="e.g. costCenter"
                  value={newAttr.attribute_name}
                  onChange={e => setNewAttr(a => ({ ...a, attribute_name: e.target.value.replace(/\s/g, '') }))}
                  style={{ fontFamily: 'monospace' }} />
              </div>
              <div className="form-group">
                <label>Display Name</label>
                <input className="form-control" placeholder="e.g. Cost Center"
                  value={newAttr.display_name}
                  onChange={e => setNewAttr(a => ({ ...a, display_name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Attribute Type</label>
                <select className="form-control" value={newAttr.attribute_type}
                  onChange={e => setNewAttr(a => ({ ...a, attribute_type: e.target.value }))}>
                  {ATTR_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAddAttrOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createAttr}>Add Attribute</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
