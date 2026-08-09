import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Trash2, ChevronDown, ChevronRight, Play, RotateCcw,
         Code, Settings, CheckCircle, XCircle, AlertCircle, Copy, Save } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

const OPERATIONS = ['Create', 'Update', 'Enable', 'Disable', 'Delete', 'Unlock'];

const OP_COLORS = {
  Create:  { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#10b981' },
  Update:  { bg: 'rgba(59,130,246,0.15)', border: '#3b82f6', text: '#3b82f6' },
  Enable:  { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#10b981' },
  Disable: { bg: 'rgba(245,158,11,0.15)', border: '#f59e0b', text: '#f59e0b' },
  Delete:  { bg: 'rgba(239,68,68,0.15)',  border: '#ef4444', text: '#ef4444' },
  Unlock:  { bg: 'rgba(139,92,246,0.15)', border: '#8b5cf6', text: '#8b5cf6' },
};

const SOURCE_OPTIONS = [
  { value: 'identity',   label: 'Identity Attribute' },
  { value: 'static',     label: 'Static Value' },
  { value: 'rule',       label: 'Rule (JS Script)' },
  { value: 'generator',  label: 'Generator' },
  { value: 'account',    label: 'Account Attribute' },
];

const GENERATOR_OPTIONS = [
  'email','username','display_name','first_name','last_name',
  'employee_id','phone','department','title','uuid',
];

const TRANSFORM_OPTIONS = [
  { value: 'none',         label: 'None' },
  { value: 'upper',        label: 'Uppercase' },
  { value: 'lower',        label: 'Lowercase' },
  { value: 'trim',         label: 'Trim Whitespace' },
  { value: 'concat',       label: 'Concatenate Fields' },
  { value: 'split',        label: 'Split String' },
  { value: 'regex',        label: 'Regex Extract' },
  { value: 'date_format',  label: 'Date Format' },
  { value: 'lookup',       label: 'Lookup Table' },
  { value: 'conditional',  label: 'Conditional' },
  { value: 'username_gen', label: 'Username Generator' },
];

const IDENTITY_FIELDS = [
  'username','email','first_name','last_name','display_name',
  'title','department','phone','employee_id','manager_id',
];

const DEFAULT_RULE = `// Available variables: identity, account, connector, operation, attributes
// Set 'result' to the value you want
result = identity.first_name + " " + identity.last_name;`;

// ─── Field Row ──────────────────────────────────────────────────────────────
function FieldRow({ field, index, onChange, onDelete, identityFields }) {
  const [expanded, setExpanded] = useState(false);

  const update = (key, val) => onChange(index, { ...field, [key]: val });

  return (
    <div style={{ border: '1px solid #2a3545', borderRadius: 6, marginBottom: 8, background: 'var(--bg-card)' }}>
      {/* Row header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}
           onClick={() => setExpanded(e => !e)}>
        <span style={{ color: 'var(--text-muted)', width: 20, textAlign: 'center' }}>{index + 1}</span>
        {expanded ? <ChevronDown size={14} color="#64748b"/> : <ChevronRight size={14} color="#64748b"/>}
        <input
          value={field.name || ''}
          onChange={e => { e.stopPropagation(); update('name', e.target.value); }}
          onClick={e => e.stopPropagation()}
          placeholder="Field name (e.g. userName)"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontFamily: 'monospace', fontWeight: 600, flex: 1, outline: 'none', minWidth: 0 }}
        />
        <span style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 4 }}>
          {SOURCE_OPTIONS.find(s => s.value === field.source)?.label || field.source}
        </span>
        {field.required && (
          <span style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4 }}>required</span>
        )}
        <button onClick={e => { e.stopPropagation(); onDelete(index); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
          <Trash2 size={14}/>
        </button>
      </div>

      {expanded && (
        <div style={{ padding: '0 12px 12px', borderTop: '1px solid #1e2a3a' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
            {/* Label */}
            <div>
              <label style={labelStyle}>Display Label</label>
              <input value={field.label || ''} onChange={e => update('label', e.target.value)}
                     placeholder="Human-readable label" style={inputStyle}/>
            </div>
            {/* Source */}
            <div>
              <label style={labelStyle}>Value Source</label>
              <select value={field.source || 'identity'} onChange={e => update('source', e.target.value)} style={inputStyle}>
                {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* Value / generator */}
            <div>
              {field.source === 'identity' && (
                <>
                  <label style={labelStyle}>Identity Attribute</label>
                  <select value={field.value || ''} onChange={e => update('value', e.target.value)} style={inputStyle}>
                    <option value="">— select —</option>
                    {(identityFields || IDENTITY_FIELDS).map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </>
              )}
              {field.source === 'static' && (
                <>
                  <label style={labelStyle}>Static Value</label>
                  <input value={field.value ?? ''} onChange={e => update('value', e.target.value)}
                         placeholder="e.g. true, admin, /org" style={inputStyle}/>
                </>
              )}
              {field.source === 'generator' && (
                <>
                  <label style={labelStyle}>Generator</label>
                  <select value={field.generator || ''} onChange={e => update('generator', e.target.value)} style={inputStyle}>
                    <option value="">— select —</option>
                    {GENERATOR_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </>
              )}
              {field.source === 'account' && (
                <>
                  <label style={labelStyle}>Account Attribute</label>
                  <input value={field.value || ''} onChange={e => update('value', e.target.value)}
                         placeholder="e.g. nativeIdentity" style={inputStyle}/>
                </>
              )}
              {field.source === 'rule' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 20 }}>
                  <Code size={14} color="#8b5cf6"/>
                  <span style={{ color: '#8b5cf6' }}>Rule script below</span>
                </div>
              )}
            </div>
          </div>

          {/* Rule script editor */}
          {field.source === 'rule' && (
            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>Rule Script (JS) — set <code style={{ color: '#8b5cf6' }}>result</code></label>
              <textarea
                value={field.rule_script || DEFAULT_RULE}
                onChange={e => update('rule_script', e.target.value)}
                rows={5}
                style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
              />
            </div>
          )}

          {/* Transform */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
            <div>
              <label style={labelStyle}>Transform</label>
              <select value={field.transform || 'none'} onChange={e => update('transform', e.target.value)} style={inputStyle}>
                {TRANSFORM_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, paddingBottom: 2 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!field.required} onChange={e => update('required', e.target.checked)}
                       style={{ accentColor: '#ef4444' }}/>
                <span style={{ color: 'var(--text-secondary)' }}>Required</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!field.multi_valued} onChange={e => update('multi_valued', e.target.checked)}
                       style={{ accentColor: '#3b82f6' }}/>
                <span style={{ color: 'var(--text-secondary)' }}>Multi-valued</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Operation Panel ────────────────────────────────────────────────────────
function OperationPanel({ policy, connectorId, onSaved, identityFields, users }) {
  const [fields, setFields] = useState(policy.fields || []);
  const [enabled, setEnabled] = useState(policy.enabled !== false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testIdentityId, setTestIdentityId] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const col = OP_COLORS[policy.operation] || OP_COLORS.Create;

  useEffect(() => {
    setFields(policy.fields || []);
    setEnabled(policy.enabled !== false);
    setDirty(false);
    setTestResult(null);
  }, [policy]);

  const updateField = (idx, updated) => {
    setFields(f => { const n = [...f]; n[idx] = updated; return n; });
    setDirty(true);
  };
  const deleteField = (idx) => {
    setFields(f => f.filter((_, i) => i !== idx));
    setDirty(true);
  };
  const addField = () => {
    setFields(f => [...f, { name: '', label: '', source: 'identity', value: '', required: false }]);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await API.put('/provisioning-policies', {
        connector_id: connectorId, operation: policy.operation,
        fields, enabled, description: policy.description});
      toast.success(`${policy.operation} policy saved`);
      setDirty(false);
      onSaved && onSaved();
    } catch { toast.error('Failed to save policy'); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm(`Reset ${policy.operation} policy to defaults?`)) return;
    try {
      await API.post('/provisioning-policies/reset', { connector_id: connectorId, operation: policy.operation });
      toast.success('Reset to defaults');
      onSaved && onSaved();
    } catch { toast.error('Reset failed'); }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await API.post('/provisioning-policies/test', {
        connector_id: connectorId, operation: policy.operation,
        fields, identity_id: testIdentityId || undefined});
      setTestResult({ success: true, data });
    } catch (e) {
      setTestResult({ success: false, error: e.response?.data?.error || e.message });
    } finally { setTesting(false); }
  };

  return (
    <div style={{ marginBottom: 24, border: `1px solid ${col.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: col.bg, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: col.text, fontWeight: 700 }}>{policy.operation}</span>
        {policy.is_default && (
          <span style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 4 }}>default</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setDirty(true); }}
                   style={{ accentColor: col.text }}/>
            <span style={{ color: 'var(--text-secondary)' }}>Enabled</span>
          </label>
        </span>
      </div>

      {/* Fields */}
      <div style={{ padding: 16 }}>
        {fields.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
            No fields defined. {policy.operation === 'Delete' ? 'Delete operations typically need no field mapping.' : 'Add fields below.'}
          </div>
        )}
        {fields.map((f, i) => (
          <FieldRow key={i} field={f} index={i} onChange={updateField} onDelete={deleteField} identityFields={identityFields}/>
        ))}

        {/* Add field */}
        <button onClick={addField} style={{ ...btnStyle, marginTop: 4 }}>
          <Plus size={14}/> Add Field
        </button>

        {/* Test + Save bar */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={testIdentityId} onChange={e => setTestIdentityId(e.target.value)}
                  style={{ ...inputStyle, flex: 1, minWidth: 180, maxWidth: 280 }}>
            <option value="">Test with identity…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.username} ({u.email})</option>)}
          </select>
          <button onClick={test} disabled={testing} style={{ ...btnStyle, color: '#8b5cf6', borderColor: '#8b5cf6' }}>
            <Play size={14}/> {testing ? 'Running…' : 'Test'}
          </button>
          <button onClick={reset} style={{ ...btnStyle, color: 'var(--text-muted)', borderColor: 'var(--text-muted)' }}>
            <RotateCcw size={14}/> Reset to Default
          </button>
          <button onClick={save} disabled={!dirty || saving}
                  style={{ ...btnStyle, color: dirty ? col.text : 'var(--text-muted)',
                           borderColor: dirty ? col.border : 'var(--text-secondary)',
                           background: dirty ? col.bg : 'transparent' }}>
            <Save size={14}/> {saving ? 'Saving…' : 'Save Policy'}
          </button>
        </div>

        {/* Test result */}
        {testResult && (
          <div style={{ marginTop: 12, background: 'var(--bg-primary)', border: `1px solid ${testResult.success ? '#10b981' : '#ef4444'}`,
                        borderRadius: 6, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              {testResult.success
                ? <CheckCircle size={14} color="#10b981"/>
                : <XCircle size={14} color="#ef4444"/>}
              <span style={{ color: testResult.success ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                {testResult.success ? 'Resolved successfully' : 'Error'}
              </span>
              {testResult.data?.identity_used && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  identity: {testResult.data.identity_used.username || testResult.data.identity_used.email}
                </span>
              )}
            </div>
            {testResult.success ? (
              <pre style={{ color: 'var(--text-secondary)', margin: 0, overflow: 'auto', maxHeight: 300 }}>
                {JSON.stringify(testResult.data.resolved, null, 2)}
              </pre>
            ) : (
              <span style={{ color: '#ef4444' }}>{testResult.error}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function ProvisioningPolicyPage() {
  const [connectors, setConnectors] = useState([]);
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [connectorInfo, setConnectorInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [activeOp, setActiveOp] = useState(null);
  const [supportedOps, setSupportedOps] = useState([]);

  useEffect(() => {
    API.get('/connectors').then(r => setConnectors(r.data?.connectors || r.data || [])).catch(() => {});
    API.get('/users', { params: { limit: 100 } }).then(r => setUsers(r.data?.users || r.data?.data || [])).catch(() => {});
  }, []);

  const loadPolicies = useCallback(async (connectorId) => {
    setLoading(true);
    try {
      const { data } = await API.get('/provisioning-policies', { params: { connector_id: connectorId } });
      setPolicies(data.policies || []);
      setConnectorInfo(data.connector);
      setSupportedOps(data.supported_operations || OPERATIONS);
      setActiveOp(prev => prev || (data.supported_operations?.[0] || 'Create'));
    } catch (e) {
      toast.error('Failed to load policies: ' + (e.response?.data?.error || e.message));
    } finally { setLoading(false); }
  }, []);

  const handleConnectorChange = (id) => {
    setSelectedConnector(id);
    setActiveOp(null);
    if (id) loadPolicies(id);
    else { setPolicies([]); setConnectorInfo(null); }
  };

  const currentPolicy = policies.find(p => p.operation === activeOp);
  const identityFields = IDENTITY_FIELDS;

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: 'var(--text-secondary)', fontSize: 24, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={24} color="#06b6d4"/>
          Provisioning Policies
        </h1>
        <p style={{ color: 'var(--text-muted)', margin: '6px 0 0' }}>
          Configure per-connector field mappings for each provisioning operation — Create, Update, Enable, Disable, Delete.
        </p>
      </div>

      {/* Connector selector */}
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid #1e2a3a', borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <label style={{ color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: 8 }}>
          CONNECTOR
        </label>
        <select
          value={selectedConnector || ''}
          onChange={e => handleConnectorChange(e.target.value || null)}
          style={{ ...inputStyle, maxWidth: 420 }}
        >
          <option value="">— Select a connector to configure policies —</option>
          {connectors.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
          ))}
        </select>

        {connectorInfo && (
          <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span style={chipStyle}>Type: {connectorInfo.type}</span>
            <span style={chipStyle}>{supportedOps.length} supported operations</span>
            {policies.filter(p => !p.is_default).length > 0 && (
              <span style={{ ...chipStyle, color: '#10b981', borderColor: '#10b981' }}>
                {policies.filter(p => !p.is_default).length} custom policies saved
              </span>
            )}
          </div>
        )}
      </div>

      {!selectedConnector && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <Shield size={48} color="#1e2a3a" style={{ marginBottom: 16 }}/>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Select a connector to configure its provisioning policies</div>
          <div style={{ marginTop: 6 }}>Policies define which identity attributes map to target app fields for each operation</div>
        </div>
      )}

      {selectedConnector && loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading policies…</div>
      )}

      {selectedConnector && !loading && policies.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 20, alignItems: 'start' }}>
          {/* Operation nav */}
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid #1e2a3a', borderRadius: 10, overflow: 'hidden', position: 'sticky', top: 20 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #1e2a3a', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em' }}>
              OPERATIONS
            </div>
            {policies.map(p => {
              const col = OP_COLORS[p.operation] || OP_COLORS.Create;
              const active = activeOp === p.operation;
              return (
                <div key={p.operation}
                     onClick={() => setActiveOp(p.operation)}
                     style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                              background: active ? col.bg : 'transparent',
                              borderLeft: active ? `3px solid ${col.border}` : '3px solid transparent',
                              transition: 'all 0.15s' }}>
                  <span style={{ color: active ? col.text : 'var(--text-secondary)', fontWeight: active ? 700 : 400 }}>
                    {p.operation}
                  </span>
                  {!p.is_default && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: col.border, marginLeft: 'auto', flexShrink: 0 }}/>
                  )}
                  {!p.enabled && (
                    <XCircle size={12} color="#ef4444" style={{ marginLeft: 'auto' }}/>
                  )}
                </div>
              );
            })}
          </div>

          {/* Policy editor */}
          <div>
            {currentPolicy ? (
              <OperationPanel
                key={currentPolicy.operation}
                policy={currentPolicy}
                connectorId={selectedConnector}
                onSaved={() => loadPolicies(selectedConnector)}
                identityFields={identityFields}
                users={users}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Select an operation</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '8px 10px', background: 'var(--bg-tertiary)', border: '1px solid #2a3545',
  borderRadius: 6, color: 'var(--text-secondary)', boxSizing: 'border-box',
};
const labelStyle = {
  display: 'block', color: 'var(--text-muted)', fontWeight: 700,
  letterSpacing: '0.05em', marginBottom: 5, textTransform: 'uppercase',
};
const btnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
  background: 'transparent', border: '1px solid #2a3545', borderRadius: 6,
  color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 500,
};
const chipStyle = {, color: 'var(--text-muted)', border: '1px solid #2a3545',
  borderRadius: 4, padding: '3px 10px',
};
