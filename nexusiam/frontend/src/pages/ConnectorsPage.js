import React, { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Wifi, WifiOff, Search, ArrowRight, ArrowLeftRight,
  ChevronRight, X, CheckCircle, Database, Zap, GitMerge, Eye,
  Download, Upload, Trash2 } from 'lucide-react';
import API from '../utils/api';
import OwnerPicker from '../components/OwnerPicker';
import toast from 'react-hot-toast';
import PaginationControls from '../components/PaginationControls';
import { useNavigate } from 'react-router-dom';

const CAT_COLORS = { 'Directory':'#06b6d4','Cloud IAM':'#8b5cf6','HR Systems':'#10b981','Database':'#f59e0b','Standard Protocol':'#3b82f6','Enterprise SaaS':'#f97316','ITSM':'#ec4899','Developer Tools':'var(--text-muted)','Productivity':'#84cc16','Collaboration':'#14b8a6','Cloud Platform':'#f59e0b','Cloud Storage':'#06b6d4','CRM':'#ef4444','Customer Support':'#8b5cf6','Privileged Access':'#dc2626','File-based':'var(--text-secondary)','Custom':'#6366f1' };

const NEXUS_FIELDS = [
  {name:'username',label:'Username'},{name:'email',label:'Email'},{name:'first_name',label:'First Name'},
  {name:'last_name',label:'Last Name'},{name:'display_name',label:'Display Name'},{name:'department',label:'Department'},
  {name:'title',label:'Job Title'},{name:'phone',label:'Phone'},{name:'employee_id',label:'Employee ID'},
  {name:'manager',label:'Manager'},{name:'status',label:'Status'},{name:'external_id',label:'External ID'},
  {name:'attributes.custom1',label:'Custom Attr 1'},{name:'attributes.custom2',label:'Custom Attr 2'},
];

export default function ConnectorsPage() {
  const navigate = useNavigate();
  const [connectors, setConnectors] = useState([]);
  const [catalog, setCatalog] = useState({});
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [selectedType, setSelectedType] = useState(null);
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [editingConnectorId, setEditingConnectorId] = useState(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [transformers, setTransformers] = useState([]);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardForm, setWizardForm] = useState({ name:'', description:'', provisioning_direction:'bidirectional', sync_schedule:'0 2 * * *', create_application:true, application_name:'', config:{}, owner:null, is_authoritative:false, is_sox:false, is_birthright:false });
  const [schema, setSchema] = useState([]);
  const [schemaTab, setSchemaTab] = useState('account');

  const [customAttrs, setCustomAttrs] = useState([]);
  const [discoveringSchema, setDiscoveringSchema] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customAttrForm, setCustomAttrForm] = useState({ name:'', type:'string', description:'', is_required:false, default_value:'' });
  const [missingFields, setMissingFields] = useState([]); // required field validation popup
  const [mappings, setMappings] = useState([]);
  const [testRecord, setTestRecord] = useState('{"username":"jdoe","email":"jdoe@company.com","first_name":"John","last_name":"Doe","department":"Engineering"}');
  const [testResult, setTestResult] = useState(null);
  const [accountPreview, setAccountPreview] = useState([]);
  const [accountPagination, setAccountPagination] = useState({ total:0, page:1, limit:20, pages:1 });
  const [expandedAccounts, setExpandedAccounts] = useState({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, cat, tx] = await Promise.all([API.get('/connectors'), API.get('/connectors/catalog'), API.get('/connectors/transformers/list')]);
      setConnectors(c.data); setCatalog(cat.data.catalog); setCategories(cat.data.categories); setTransformers(tx.data);
    } catch { toast.error('Failed to load'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const findDef = (type) => Object.values(catalog).flat().find(c => c.type === type);
  const findCat = (type) => Object.keys(catalog).find(cat => catalog[cat]?.find(c => c.type === type));
  const isJdbcType = (type) => String(type || '').startsWith('jdbc_');

  const openWizard = (ct) => {
    setEditingConnectorId(null);
    setSelectedType(ct);
    setWizardStep(1);
    setWizardForm({ name:`${ct.displayName} Connector`, description:'', provisioning_direction:'bidirectional', sync_schedule:'0 2 * * *', create_application:true, application_name:`${ct.displayName} Application`, config:{}, owner:null, is_authoritative:false, is_sox:false, is_birthright:false });
    setView('wizard');
  };

  const openEditor = async (conn) => {
    try {
      const r = await API.get(`/connectors/${conn.id}`);
      const full = r.data;
      const def = findDef(full.type) || { type: full.type, displayName: full.type, configSchema: [] };
      // Fetch linked application to get saved flags
      let linkedApp = null;
      try {
        const appsRes = await API.get('/applications');
        linkedApp = (appsRes.data || []).find(a =>
          a.metadata?.connector_id === full.id ||
          a.provisioning_config?.connector_id === full.id
        ) || null;
      } catch {}
      setEditingConnectorId(full.id);
      setSelectedType(def);
      setWizardStep(1);
      setWizardForm({
        name: full.name || '',
        description: full.description || '',
        provisioning_direction: full.provisioning_direction || 'bidirectional',
        sync_schedule: full.sync_schedule || '',
        create_application: true,
        application_name: linkedApp?.name || (full.name ? `${full.name.replace(/ Connector$/, '')} Application` : ''),
        config: full.config || {},
        owner: null,
        is_authoritative: !!linkedApp?.is_authoritative,
        is_sox: !!linkedApp?.is_sox,
        is_birthright: !!linkedApp?.is_birthright,
      });
      setView('wizard');
    } catch {
      toast.error('Failed to open connector');
    }
  };

  const openSchema = async (conn) => {
    setSelectedConnector(conn); setView('schema'); setSchemaTab('account');

    const [s, cu] = await Promise.all([API.get(`/connectors/${conn.id}/schema`), API.get(`/connectors/${conn.id}/schema/custom`)]);
    setSchema(s.data.accountSchema || s.data.schema || []);
    setCustomAttrs(cu.data || []);
    setSelectedConnector({ ...conn, _groupSchema: s.data.groupSchema || [] });

  };


  const loadAccounts = async (conn, page = 1, limit = 20) => {
    const r = await API.get(`/connectors/${conn.id}/accounts?page=${page}&limit=${limit}`);
    setAccountPreview(r.data.data || []);
    setAccountPagination({ total: r.data.total || 0, page: r.data.page || page, limit: r.data.limit || limit, pages: r.data.pages || 1 });
  };

  const openAccounts = async (conn) => {
    try {
      setSelectedConnector(conn);
      await loadAccounts(conn, 1, accountPagination.limit || 20);
      setView('accounts');
    } catch { toast.error('Failed to load aggregated accounts'); }
  };

  const openMapper = async (conn) => {
    setSelectedConnector(conn); setView('mapper');
    const [s, m] = await Promise.all([API.get(`/connectors/${conn.id}/schema`), API.get(`/connectors/${conn.id}/mappings`)]);
    setSchema(s.data.schema || []);
    setMappings(m.data?.length ? m.data : NEXUS_FIELDS.slice(0,5).map(f => ({ source_attr:f.name, target_attr:'', transformer_type:'direct', transformer_config:{}, direction:'both' })));
  };

  const handleCreate = async () => {
    try {
      const cfg = { ...wizardForm.config };
      if (cfg.fetch_all_users_sql && !cfg.query_fetch_all_users) cfg.query_fetch_all_users = cfg.fetch_all_users_sql;
      if (cfg.create_user_sql && !cfg.query_create_user) cfg.query_create_user = cfg.create_user_sql;
      if (cfg.update_user_sql && !cfg.query_update_user) cfg.query_update_user = cfg.update_user_sql;
      if (cfg.delete_user_sql && !cfg.query_delete_user) cfg.query_delete_user = cfg.delete_user_sql;
      if (editingConnectorId) {
        await API.put(`/connectors/${editingConnectorId}`, { ...wizardForm, config: cfg });
        toast.success('Connector updated');
        setEditingConnectorId(null);
        setView('list');
        fetchAll();
      } else {
        const res = await API.post('/connectors', { ...wizardForm, type: selectedType.type, config: cfg });
        toast.success('Connector created!');
        if (wizardForm.create_application && res.data?.application?.id) {
          toast.success('Application auto-created and linked');
          navigate(res.data.redirectTo || `/applications?open=${res.data.application.id}`);
        } else {
          setView('list');
          fetchAll();
        }
      }
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const handleTest = async (id) => {
    try {
      const r = await API.post(`/connectors/${id}/test`);
      const suffix = r.data?.columns?.length ? ` • ${r.data.columns.length} columns detected` : '';
      toast.success(`✓ Connected! ${r.data.latency}ms${suffix}`);
      fetchAll();
    } catch (err) { toast.error(err.response?.data?.message || 'Connection failed'); fetchAll(); }
  };

  const handleTestCurrentConfig = async () => {
    try {
      const cfg = { ...wizardForm.config };
      if (cfg.fetch_all_users_sql && !cfg.query_all_users) cfg.query_all_users = cfg.fetch_all_users_sql;
      if (cfg.fetch_single_user_sql && !cfg.query_get_user) cfg.query_get_user = cfg.fetch_single_user_sql;
      if (cfg.user_table_name && !cfg.user_table) cfg.user_table = cfg.user_table_name;
      if (cfg.database_name && !cfg.database) cfg.database = cfg.database_name;
      if (cfg.database_host && !cfg.host) cfg.host = cfg.database_host;
      const r = await API.post('/connectors/test-config', { type: selectedType.type, config: cfg });
      const suffix = r.data?.columns?.length ? ` • ${r.data.columns.length} columns detected` : '';
      toast.success(`✓ Connected! ${r.data.latency}ms${suffix}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Connection failed');
    }
  };

  const handleSync = async (conn) => {
    try { const r = await API.post(`/connectors/${conn.id}/sync`, { direction: conn.provisioning_direction || 'pull' }); toast.success(`Sync started (${r.data.direction})`); }
    catch { toast.error('Sync failed'); }
  };

  const handleDiscoverSchema = async () => {
    setDiscoveringSchema(true);
    try {
      const r = await API.post(`/connectors/${selectedConnector.id}/schema/discover`);
      const accountSchema = r.data.accountSchema || r.data.schema || [];
      const groupSchema = r.data.groupSchema || [];
      setSchema(accountSchema);
      setSelectedConnector(prev => ({ ...prev, _groupSchema: groupSchema }));
      toast.success(`Discovered ${r.data.count || accountSchema.length} account attrs · ${r.data.groupCount || groupSchema.length} group attrs`);
    }
    catch (err) { toast.error(err.response?.data?.error || 'Discovery failed'); }
    finally { setDiscoveringSchema(false); }
  };

  const handleAddCustomAttr = async (e) => {
    e.preventDefault();
    try {
      const r = await API.post(`/connectors/${selectedConnector.id}/schema/custom`, customAttrForm);
      setCustomAttrs([...customAttrs, r.data]);
      setSchema([...schema, { name:customAttrForm.name, type:customAttrForm.type, description:customAttrForm.description, isCustom:true }]);
      setShowAddCustom(false); setCustomAttrForm({ name:'', type:'string', description:'', is_required:false, default_value:'' });
      toast.success('Custom attribute added');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const handleDeleteCustomAttr = async (attr) => {
    const dbAttr = customAttrs.find(a => a.attribute_name === attr.name);
    if (!dbAttr) return;
    await API.delete(`/connectors/${selectedConnector.id}/schema/custom/${dbAttr.id}`);
    setCustomAttrs(customAttrs.filter(a => a.id !== dbAttr.id)); setSchema(schema.filter(s => s.name !== attr.name));
    toast.success('Removed');
  };

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteJustification, setDeleteJustification] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDeleteConnector = async () => {
    if (!deleteJustification.trim()) { toast.error('Business justification is required'); return; }
    setDeleting(true);
    try {
      await API.delete(`/connectors/${deleteTarget.id}`, { data: { justification: deleteJustification.trim() } });
      toast.success(`Connector "${deleteTarget.name}" deleted and all data removed`);
      setDeleteTarget(null);
      setDeleteJustification('');
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveMappings = async () => {
    try { await API.put(`/connectors/${selectedConnector.id}/mappings`, { mappings }); toast.success(`${mappings.length} mappings saved`); }
    catch { toast.error('Save failed'); }
  };

  const handleTestMappings = async () => {
    try { const r = await API.post(`/connectors/${selectedConnector.id}/mappings/test`, { sampleRecord: JSON.parse(testRecord), mappings, direction:'push' }); setTestResult(r.data); }
    catch (err) { toast.error(`Test failed: ${err.message}`); }
  };

  const updateMapping = (i, field, val) => setMappings(mappings.map((m,idx) => idx===i ? {...m,[field]:val} : m));

  // Filter catalog
  const filteredCatalog = {};
  for (const [cat, items] of Object.entries(catalog)) {
    const f = items.filter(c => !catalogSearch || c.displayName.toLowerCase().includes(catalogSearch.toLowerCase()) || c.type.toLowerCase().includes(catalogSearch.toLowerCase()) || (c.description||'').toLowerCase().includes(catalogSearch.toLowerCase()));
    if (f.length) filteredCatalog[cat] = f;
  }
  const totalTypes = Object.values(catalog).flat().length;

  // ── CATALOG VIEW ────────────────────────────────────────────────────────────
  if (view === 'catalog') return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Connector Catalog</div><div className="page-subtitle">{totalTypes} connector types — {categories.length} categories</div></div>
        <button className="btn btn-secondary" onClick={() => setView('list')}><X size={14} /> Close</button>
      </div>
      <div className="search-bar" style={{ marginBottom: 24 }}>
        <div className="search-input-wrap" style={{ flex:1, maxWidth:480 }}>
          <Search size={14} className="search-icon" />
          <input placeholder="Search… Okta, JDBC, SCIM, SAP, Salesforce, AD…" value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} />
        </div>
        <span style={{ color:'var(--text-muted)', alignSelf:'center' }}>{Object.values(filteredCatalog).flat().length} results</span>
      </div>
      {Object.entries(filteredCatalog).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom:28 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
            <div style={{ width:4, height:20, borderRadius:2, background: CAT_COLORS[cat]||'var(--text-muted)' }} />
            <span style={{ fontWeight:700, color:'var(--text-primary)' }}>{cat}</span>
            <span style={{ color:'var(--text-muted)' }}>({items.length})</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:10 }}>
            {items.map(ct => (
              <div key={ct.type} className="card" style={{ cursor:'pointer', padding:16, border:'1px solid #1e293b', transition:'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = CAT_COLORS[cat]||'var(--text-muted)'; e.currentTarget.style.background = `${CAT_COLORS[cat]||'var(--text-muted)'}08`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--bg-tertiary)'; e.currentTarget.style.background=''; }}
                onClick={() => openWizard(ct)}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <div style={{ fontWeight:600, color:'var(--text-primary)' }}>{ct.displayName}</div>
                  <span style={{ padding:'2px 6px', borderRadius:3, background:`${CAT_COLORS[cat]||'var(--text-muted)'}20`, color:CAT_COLORS[cat]||'var(--text-secondary)', fontWeight:700 }}>{(ct.protocol||'').toUpperCase()}</span>
                </div>
                <div style={{ color:'var(--text-muted)', marginBottom:8, lineHeight:1.4 }}>{ct.description}</div>
                <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                  {(ct.capabilities||[]).slice(0,3).map(cap => (
                    <span key={cap} style={{ padding:'2px 6px', borderRadius:3, background:'var(--bg-tertiary)', color:'var(--text-secondary)' }}>{cap.replace(/_/g,' ')}</span>
                  ))}
                  {ct.capabilities?.length>3 && <span style={{ color:'var(--text-secondary)' }}>+{ct.capabilities.length-3}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // ── WIZARD VIEW ────────────────────────────────────────────────────────────
  if (view === 'wizard') {
    const def = selectedType;
    const catName = Object.keys(catalog).find(cat => catalog[cat]?.find(c => c.type === def?.type));
    const cc = CAT_COLORS[catName] || '#06b6d4';
    const steps = ['Basic Info', 'Connection Config', 'Provisioning'];
    return (
      <>
      <div style={{ maxWidth:720 }}>
        <div className="page-header">
          <div><div className="page-title">{editingConnectorId ? 'Edit' : 'Add'} {def?.displayName}</div><div className="page-subtitle">Step {wizardStep} of 3</div></div>
          <button className="btn btn-secondary" onClick={() => { setView('list'); setWizardStep(1); setEditingConnectorId(null); }}><X size={14} /> Cancel</button>
        </div>
        <div style={{ display:'flex', gap:4, marginBottom:28 }}>
          {steps.map((step, i) => (
            <React.Fragment key={step}>
              <div style={{ flex:1, padding:'10px 14px', borderRadius:8, background: wizardStep===i+1 ? `${cc}15` : 'transparent', border: wizardStep===i+1 ? `1px solid ${cc}40` : '1px solid transparent', display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:22, height:22, borderRadius:'50%', background: wizardStep>i ? cc : wizardStep===i+1 ? cc : 'var(--bg-tertiary)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color: wizardStep>=i+1 ? '#fff' : 'var(--text-muted)', flexShrink:0 }}>{wizardStep>i+1 ? '✓' : i+1}</div>
                <span style={{ fontWeight:wizardStep===i+1?600:400, color:wizardStep===i+1?'var(--text-primary)':'var(--text-muted)' }}>{step}</span>
              </div>
              {i<2 && <ChevronRight size={14} color="#475569" style={{ alignSelf:'center', flexShrink:0 }} />}
            </React.Fragment>
          ))}
        </div>
        <div className="card">
          {wizardStep===1 && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:20 }}>
                <div style={{ width:10, height:10, borderRadius:'50%', background:cc }} />
                <span style={{ fontWeight:600, color:'var(--text-primary)' }}>{def?.displayName}</span>
                <span style={{ color:'var(--text-muted)' }}>— {def?.description}</span>
              </div>
              <div className="form-group"><label>Connector Name *</label><input value={wizardForm.name} onChange={e => setWizardForm({...wizardForm, name:e.target.value})} /></div>
              <div className="form-group"><label>Description</label><textarea value={wizardForm.description} onChange={e => setWizardForm({...wizardForm, description:e.target.value})} rows={2} /></div>
              <div className="form-group">
                <label>Owner <span style={{ color:'var(--text-muted)', fontWeight:400 }}>(identity or workgroup)</span></label>
                <OwnerPicker value={wizardForm.owner} onChange={owner => setWizardForm({...wizardForm, owner})} placeholder="Assign owner…" />
              </div>
              <div style={{ display:'flex', gap:24, marginBottom:16 }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', color:'var(--border-bright)' }}>
                  <input type="checkbox" checked={!!wizardForm.is_authoritative}
                    onChange={e => setWizardForm({...wizardForm, is_authoritative: e.target.checked})}
                    style={{ accentColor:'#10b981', width:15, height:15 }} />
                  <span>Authoritative Source</span>
                  <span style={{ color:'var(--text-secondary)' }}>(identities created from this connector)</span>
                </label>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', color:'var(--border-bright)' }}>
                  <input type="checkbox" checked={!!wizardForm.is_sox}
                    onChange={e => setWizardForm({...wizardForm, is_sox: e.target.checked})}
                    style={{ accentColor:'#f59e0b', width:15, height:15 }} />
                  <span style={{ color: wizardForm.is_sox ? '#fbbf24' : 'var(--border-bright)' }}>SOX Application ⚡</span>
                </label>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', color:'var(--border-bright)' }}>
                  <input type="checkbox" checked={!!wizardForm.is_birthright}
                    onChange={e => setWizardForm({...wizardForm, is_birthright: e.target.checked})}
                    style={{ accentColor:'#06b6d4', width:15, height:15 }} />
                  <span style={{ color: wizardForm.is_birthright ? '#06b6d4' : 'var(--border-bright)' }}>Birthright Application 🎯</span>
                  <span style={{ color:'var(--text-secondary)' }}>(auto-assigned to all new users)</span>
                </label>
              </div>
              {!editingConnectorId && <div className="grid-2"><div className="form-group"><label>Auto-create Application</label><select value={wizardForm.create_application ? 'yes' : 'no'} onChange={e => setWizardForm({ ...wizardForm, create_application: e.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">No</option></select></div><div className="form-group"><label>Application Name</label><input value={wizardForm.application_name || ''} onChange={e => setWizardForm({ ...wizardForm, application_name: e.target.value })} disabled={!wizardForm.create_application} /></div></div>}
              {isJdbcType(def?.type) && <div style={{ color:'var(--text-secondary)', marginTop:6 }}>If your source database is running on your laptop and NexusIAM is running in Docker, try <code>host.docker.internal</code>. If NexusIAM is running directly on your machine, use <code>localhost</code>.</div>}
              <div style={{ padding:14, background:'var(--bg-primary)', borderRadius:8, marginTop:12 }}>
                <div style={{ color:'var(--text-muted)', marginBottom:8, fontWeight:600 }}>CAPABILITIES</div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {(def?.capabilities||[]).map(cap => <span key={cap} style={{ padding:'3px 8px', borderRadius:4, background:'var(--bg-tertiary)', color:cc }}>{cap.replace(/_/g,' ')}</span>)}
                </div>
              </div>
            </div>
          )}
          {wizardStep===2 && (
            <div>
              <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:20 }}>Connection Settings — {def?.displayName}</div>
              {isJdbcType(selectedType?.type) && (
                <div style={{ padding:'12px 16px', background:'rgba(6,182,212,0.05)', borderRadius:8, border:'1px solid rgba(6,182,212,0.15)', marginBottom:16, color:'var(--text-secondary)' }}>
                  <strong style={{ color:'#06b6d4' }}>Database connector model:</strong> define the DB connection, the account source table/query, and the identity correlation field.
                  Example: <span className="mono" style={{ color:'var(--text-secondary)' }}>correlation_attribute = email</span> means imported account rows will correlate to a NexusIAM identity by email.
                  For local testing from Docker, <span className="mono" style={{ color:'var(--text-secondary)' }}>localhost</span> is auto-mapped to <span className="mono" style={{ color:'var(--text-secondary)' }}>host.docker.internal</span>.
                </div>
              )}
              {(def?.configSchema||[]).length===0 && <p style={{ color:'var(--text-muted)' }}>No configuration required for this connector type.</p>}
              {(def?.configSchema||[]).map(field => {
                // showIf: { key: 'auth_type', value: 'bearer_token' } — only show field if condition matches
                if (field.showIf) {
                  const condVal = wizardForm.config[field.showIf.key] ?? field.showIf.default ?? '';
                  const expected = Array.isArray(field.showIf.value) ? field.showIf.value : [field.showIf.value];
                  if (!expected.includes(condVal)) return null;
                }
                return (
                <div key={field.key} className="form-group">
                  <label>{field.label}{field.required && ' *'}</label>
                  {field.type==='textarea' ? (
                    <textarea value={wizardForm.config[field.key]||''} onChange={e => setWizardForm({...wizardForm, config:{...wizardForm.config,[field.key]:e.target.value}})} rows={4} placeholder={field.placeholder} />
                  ) : field.type==='select' ? (
                    <select value={wizardForm.config[field.key]||field.default||''} onChange={e => setWizardForm({...wizardForm, config:{...wizardForm.config,[field.key]:e.target.value}})}>
                      {(field.options||[]).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : field.type==='boolean' ? (
                    <label style={{ display:'flex', alignItems:'center', gap:8, margin:0, textTransform:'none', cursor:'pointer' }}>
                      <input type="checkbox" checked={wizardForm.config[field.key]??field.default??false} onChange={e => setWizardForm({...wizardForm, config:{...wizardForm.config,[field.key]:e.target.checked}})} />
                      {field.label}
                    </label>
                  ) : (
                    <input type={field.type==='password'?'password':field.type==='number'?'number':'text'} value={wizardForm.config[field.key]??field.default??''} onChange={e => setWizardForm({...wizardForm, config:{...wizardForm.config,[field.key]:e.target.value}})} placeholder={field.placeholder} />
                  )}
                </div>
                );
              })}
            </div>
          )}
          {wizardStep===3 && (
            <div>
              <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:20 }}>Provisioning Direction</div>
              <div style={{ display:'flex', gap:12, marginBottom:24 }}>
                {['pull','push','bidirectional'].map(dir => {
                  const avail = (def?.provisioningDirection||[]).includes(dir);
                  const active = wizardForm.provisioning_direction===dir;
                  return (
                    <div key={dir} onClick={() => avail && setWizardForm({...wizardForm, provisioning_direction:dir})}
                      style={{ flex:1, padding:16, borderRadius:10, border:`2px solid ${active?cc:'var(--bg-tertiary)'}`, cursor:avail?'pointer':'not-allowed', opacity:avail?1:0.35, textAlign:'center', background:active?`${cc}10`:'' }}>
                      <div style={{ marginBottom:8, display:'flex', justifyContent:'center' }}>
                        {dir==='pull' ? <Download size={22} color={active?cc:'var(--text-muted)'} /> : dir==='push' ? <Upload size={22} color={active?cc:'var(--text-muted)'} /> : <ArrowLeftRight size={22} color={active?cc:'var(--text-muted)'} />}
                      </div>
                      <div style={{ fontWeight:600, color:'var(--text-primary)', textTransform:'capitalize' }}>{dir}</div>
                      <div style={{ color:'var(--text-muted)', marginTop:4 }}>{dir==='pull'?'App → NexusIAM':dir==='push'?'NexusIAM → App':'Both directions'}</div>
                    </div>
                  );
                })}
              </div>
              <div className="form-group">
                <label>Sync Schedule (cron)</label>
                <input value={wizardForm.sync_schedule} onChange={e => setWizardForm({...wizardForm, sync_schedule:e.target.value})} className="mono" placeholder="0 2 * * *" />
                <div style={{ color:'var(--text-muted)', marginTop:4 }}>0 2 * * * = every day at 2 AM &nbsp;|&nbsp; 0 */6 * * * = every 6 hours &nbsp;|&nbsp; leave blank = manual only</div>
              </div>
            </div>
          )}
          <div style={{ display:'flex', gap:8, justifyContent:'space-between', marginTop:24, flexWrap:'wrap' }}>
            <div>
              {wizardStep>1 && <button className="btn btn-secondary" onClick={() => setWizardStep(wizardStep-1)}>Back</button>}
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {wizardStep>=2 && <button className="btn btn-secondary" onClick={handleTestCurrentConfig}><Wifi size={14} /> Test Current Config</button>}
              {wizardStep<3 ? (
                <button className="btn btn-primary" onClick={() => {
                  if (wizardStep === 1) {
                    if (!wizardForm.name.trim()) { toast.error('Connector name is required'); return; }
                    setWizardStep(2);
                    return;
                  }
                  // Step 2 → 3: validate required config fields
                  const required = (selectedType?.configSchema || []).filter(f => f.required);
                  const missing = required.filter(f => {
                    const val = wizardForm.config[f.key];
                    return val === undefined || val === null || val === '';
                  });
                  if (missing.length > 0) {
                    setMissingFields(missing);
                  } else {
                    setWizardStep(3);
                  }
                }}>Next <ChevronRight size={14} /></button>
              ) : (
                <button className="btn btn-primary" onClick={handleCreate}><CheckCircle size={14} /> {editingConnectorId ? 'Save Changes' : 'Create Connector'}</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {missingFields.length > 0 && (
        <div className="modal-overlay" onClick={() => setMissingFields([])}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 700, color: '#ef4444' }}>⚠ Missing Required Fields</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setMissingFields([])}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                The following required fields must be filled before proceeding:
              </p>
              {missingFields.map(f => (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, marginBottom: 8 }}>
                  <span style={{ color: '#ef4444', flexShrink: 0 }}>✕</span>
                  <div>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{f.label}</div>
                    {f.description && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{f.description}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setMissingFields([])}>Go Back and Fill Fields</button>
            </div>
          </div>
        </div>
      )}
      </>
    );
  }

  // ── SCHEMA VIEW ────────────────────────────────────────────────────────────
  if (view === 'schema') {
    const conn = selectedConnector;
    const activeSchema = (schemaTab === 'group' && conn?._groupSchema)
      ? conn._groupSchema
      : schema;

    return (
      <div>
        <div className="page-header">
          <div>
            <div className="page-title">{conn?.name}</div>
            <div className="page-subtitle">
              Account: {schema.length} attrs &nbsp;·&nbsp; Group: {(conn?._groupSchema || []).length} attrs
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-primary" onClick={handleDiscoverSchema} disabled={discoveringSchema}>
              <Zap size={14} /> {discoveringSchema ? 'Discovering…' : 'Auto-Discover Schema'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowAddCustom(true)}><Plus size={14} /> Add Custom Attribute</button>
            <button className="btn btn-secondary" onClick={() => setView('list')}><X size={14} /> Close</button>
          </div>
        </div>



        {/* ── Schema Tab ────────────────────────────────────── */}
        {/* Object type tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:16 }}>
          {[['account','Account Schema'],['group','Group / Entitlement Schema']].map(([t, label]) => (
            <button key={t} className={'btn btn-sm ' + (schemaTab===t ? 'btn-primary' : 'btn-secondary')}
              onClick={() => setSchemaTab(t)}>
              {label}
              <span style={{ marginLeft:6, background:'rgba(255,255,255,0.1)', borderRadius:10, padding:'1px 7px' }}>
                {t === 'account' ? schema.length : (conn?._groupSchema || []).length}
              </span>
            </button>
          ))}
        </div>

        {schemaTab === 'account' && (
          <div style={{ padding:'12px 16px', background:'rgba(6,182,212,0.05)', borderRadius:8, border:'1px solid rgba(6,182,212,0.15)', marginBottom:16, color:'var(--text-secondary)' }}>
            <strong style={{ color:'#06b6d4' }}>Account Schema:</strong> Attributes aggregated per user account from the {conn?.type?.replace(/_/g,' ')} system.
            Click <strong>Auto-Discover Schema</strong> to refresh from the live system. Add custom attributes to extend the native schema — just like SailPoint schema extensions.
          </div>
        )}
        {schemaTab === 'group' && (
          <div style={{ padding:'12px 16px', background:'rgba(139,92,246,0.05)', borderRadius:8, border:'1px solid rgba(139,92,246,0.2)', marginBottom:16, color:'var(--text-secondary)' }}>
            <strong style={{ color:'#8b5cf6' }}>Group Schema:</strong> Attributes for groups/entitlements aggregated during Group Aggregation.
            Run <strong>Auto-Discover Schema</strong> to populate this from the live system. Groups appear in the Entitlements page after a successful group aggregation.
          </div>
        )}

        <div className="card" style={{ padding:0 }}>
          <div style={{ padding:'10px 20px', borderBottom:'1px solid #1e293b', color:'var(--text-muted)' }}>
            🔵 Native (from live app schema) &nbsp;&nbsp; 🟢 Custom (defined by you) &nbsp;&nbsp; 🔒 Read-only &nbsp;&nbsp;
            {schemaTab === 'group' && <span style={{ color:'#8b5cf6' }}>★ UID = group native identity field</span>}
          </div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 32, textAlign: 'center' }} title="Include in aggregation">Incl.</th>
                <th>Attribute Name</th>
                <th style={{ width: 110 }}>Type</th>
                <th>Description</th>
                <th>Properties</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {activeSchema.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign:'center', padding:48, color:'var(--text-muted)' }}>
                  {schemaTab === 'group'
                    ? <>No group schema yet — click <strong>Auto-Discover Schema</strong> to pull the group object type from the live {conn?.type} system</>
                    : <>No schema yet — click <strong>Auto-Discover Schema</strong> to pull from {conn?.type} live system</>
                  }
                </td></tr>
              ) : activeSchema.map((attr, i) => {
                const isIncluded = attr.included !== false; // default true
                return (
                  <tr key={i} style={{ opacity: isIncluded ? 1 : 0.45 }}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        title={isIncluded ? 'Included in aggregation' : 'Excluded from aggregation'}
                        style={{ accentColor: '#06b6d4', cursor: 'pointer', width: 14, height: 14 }}
                        onChange={async (e) => {
                          const checked = e.target.checked;
                          try {
                            await API.patch(`/connectors/${conn.id}/schema/attribute`, {
                              name: attr.name, objectType: schemaTab, included: checked
                            });
                            // Update the correct local state: schema (account) or selectedConnector._groupSchema (group)
                            if (schemaTab === 'group') {
                              setSelectedConnector(prev => ({
                                ...prev,
                                _groupSchema: (prev._groupSchema || []).map(a =>
                                  a.name === attr.name ? { ...a, included: checked } : a
                                )
                              }));
                            } else {
                              setSchema(prev => prev.map(a =>
                                a.name === attr.name ? { ...a, included: checked } : a
                              ));
                            }
                          } catch { toast.error('Failed to update attribute'); }
                        }}
                      />
                    </td>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ width:7, height:7, borderRadius:'50%', background:attr.isCustom?'#10b981':schemaTab==='group'?'#8b5cf6':'#06b6d4', flexShrink:0 }} />
                        <span className="mono" style={{ color:'var(--text-primary)' }}>{attr.name}</span>
                        {attr.isUid && <span style={{ padding:'1px 5px', borderRadius:3, background:'rgba(139,92,246,0.2)', color:'#8b5cf6' }}>UID</span>}
                      </div>
                    </td>
                    <td>
                      <select
                        value={attr.type || 'string'}
                        style={{ background:'var(--bg-tertiary)', border:'1px solid #2a3545', borderRadius:4, color:'#f59e0b', padding:'2px 4px', fontFamily:'monospace', width:'100%' }}
                        onChange={async (e) => {
                          const newType = e.target.value;
                          try {
                            await API.patch(`/connectors/${conn.id}/schema/attribute`, {
                              name: attr.name, objectType: schemaTab, type: newType
                            });
                            if (schemaTab === 'group') {
                              setSelectedConnector(prev => ({
                                ...prev,
                                _groupSchema: (prev._groupSchema || []).map(a =>
                                  a.name === attr.name ? { ...a, type: newType } : a
                                )
                              }));
                            } else {
                              setSchema(prev => prev.map(a =>
                                a.name === attr.name ? { ...a, type: newType } : a
                              ));
                            }
                          } catch { toast.error('Failed to update type'); }
                        }}
                      >
                        {['string','number','boolean','date','datetime','multi_string','object','binary'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ color:'var(--text-secondary)', maxWidth:220 }}>
                      {attr.description || <span style={{ color:'var(--text-secondary)' }}>—</span>}
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        {attr.readOnly  && <span style={{ padding:'1px 5px', borderRadius:3, background:'var(--bg-tertiary)', color:'var(--text-muted)' }}>🔒 read-only</span>}
                        {attr.isRequired && <span style={{ padding:'1px 5px', borderRadius:3, background:'rgba(239,68,68,0.15)', color:'#ef4444' }}>required</span>}
                        {attr.isCustom  && <span style={{ padding:'1px 5px', borderRadius:3, background:'rgba(16,185,129,0.15)', color:'#10b981' }}>custom</span>}
                        {!isIncluded    && <span style={{ padding:'1px 5px', borderRadius:3, background:'rgba(100,116,139,0.2)', color:'var(--text-muted)' }}>excluded</span>}
                      </div>
                    </td>
                    <td>{attr.isCustom && schemaTab==='account' && <button className="btn btn-danger btn-sm" onClick={() => handleDeleteCustomAttr(attr)}>Remove</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

                {showAddCustom && (
          <div className="modal-overlay" onClick={() => setShowAddCustom(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header"><span style={{ fontWeight:600, color:'var(--text-primary)' }}>Add Custom Attribute</span><button className="btn btn-secondary btn-sm" onClick={() => setShowAddCustom(false)}>×</button></div>
              <form onSubmit={handleAddCustomAttr}>
                <div className="modal-body">
                  <div style={{ padding:12, background:'rgba(16,185,129,0.05)', borderRadius:8, border:'1px solid rgba(16,185,129,0.15)', marginBottom:16, color:'var(--text-secondary)' }}>
                    Custom attributes extend the native schema — available for mapping during sync. Examples: <span className="mono" style={{ color:'#10b981' }}>costCenter, badgeId, contractEndDate, employeeType</span>
                  </div>
                  <div className="form-group"><label>Attribute Name *</label><input value={customAttrForm.name} onChange={e => setCustomAttrForm({...customAttrForm, name:e.target.value})} placeholder="e.g. costCenter" required className="mono" /></div>
                  <div className="form-row form-row-2">
                    <div className="form-group"><label>Type</label>
                      <select value={customAttrForm.type} onChange={e => setCustomAttrForm({...customAttrForm, type:e.target.value})}>
                        {['string','number','boolean','date','datetime','multi_string','object'].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="form-group"><label>Default Value</label><input value={customAttrForm.default_value} onChange={e => setCustomAttrForm({...customAttrForm, default_value:e.target.value})} /></div>
                  </div>
                  <div className="form-group"><label>Description</label><input value={customAttrForm.description} onChange={e => setCustomAttrForm({...customAttrForm, description:e.target.value})} placeholder="What does this attribute represent?" /></div>
                  <label style={{ display:'flex', alignItems:'center', gap:8, margin:0, textTransform:'none', cursor:'pointer' }}>
                    <input type="checkbox" checked={customAttrForm.is_required} onChange={e => setCustomAttrForm({...customAttrForm, is_required:e.target.checked})} /> Required during provisioning
                  </label>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAddCustom(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Add Attribute</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── MAPPER VIEW ────────────────────────────────────────────────────────────
  if (view === 'mapper') {
    const conn = selectedConnector;
    const appFields = schema.map(s => s.name);
    return (
      <div>
        <div className="page-header">
          <div><div className="page-title">Attribute Mapper: {conn?.name}</div><div className="page-subtitle">NexusIAM canonical fields ↔ {conn?.type?.replace(/_/g,' ')} native attributes</div></div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-secondary" onClick={() => setMappings([...mappings, { source_attr:'', target_attr:'', transformer_type:'direct', transformer_config:{}, direction:'both' }])}><Plus size={14} /> Add Row</button>
            <button className="btn btn-primary" onClick={handleSaveMappings}><CheckCircle size={14} /> Save</button>
            <button className="btn btn-secondary" onClick={() => setView('list')}><X size={14} /> Close</button>
          </div>
        </div>
        <div style={{ padding:'12px 16px', background:'rgba(139,92,246,0.05)', borderRadius:8, border:'1px solid rgba(139,92,246,0.2)', marginBottom:16, color:'var(--text-secondary)' }}>
          <strong style={{ color:'#8b5cf6' }}>Attribute Mapping:</strong> Left = NexusIAM field &nbsp;→&nbsp; Right = {conn?.type} app attribute.
          Pick a <strong>Transformer</strong> to convert values (split, concat, regex, date format, value map, etc.).
          <strong> Direction</strong> controls push-only, pull-only, or both.
        </div>
        <div className="card" style={{ padding:0, marginBottom:24 }}>
          <div style={{ padding:'8px 16px', borderBottom:'1px solid #1e293b', display:'grid', gridTemplateColumns:'1fr 32px 1fr 170px 110px 36px', gap:8, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase' }}>
            <span>NexusIAM Field</span><span></span><span>App Field ({conn?.type})</span><span>Transformer</span><span>Direction</span><span></span>
          </div>
          {mappings.map((m, i) => (
            <div key={i} style={{ padding:'7px 16px', borderBottom:'1px solid #0f172a', display:'grid', gridTemplateColumns:'1fr 32px 1fr 170px 110px 36px', gap:8, alignItems:'center' }}>
              <select value={m.source_attr} onChange={e => updateMapping(i,'source_attr',e.target.value)} style={{ }}>
                <option value="">— NexusIAM —</option>
                {NEXUS_FIELDS.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}
              </select>
              <div style={{ textAlign:'center', color:'var(--text-secondary)' }}><ArrowRight size={12} /></div>
              <div>
                <input list={`af-${i}`} value={m.target_attr} onChange={e => updateMapping(i,'target_attr',e.target.value)} placeholder="App attribute…" style={{ fontFamily:'monospace', width:'100%', background:'var(--bg-primary)', border:'1px solid #1e293b', borderRadius:6, padding:'7px 10px', color:'var(--text-primary)' }} />
                <datalist id={`af-${i}`}>{appFields.map(f => <option key={f} value={f} />)}</datalist>
              </div>
              <select value={m.transformer_type} onChange={e => updateMapping(i,'transformer_type',e.target.value)} style={{ }}>
                {transformers.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              <select value={m.direction} onChange={e => updateMapping(i,'direction',e.target.value)} style={{ }}>
                <option value="both">↔ Both</option>
                <option value="push">→ Push</option>
                <option value="pull">← Pull</option>
              </select>
              <button onClick={() => setMappings(mappings.filter((_,idx) => idx!==i))} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:4 }}><X size={13} /></button>
            </div>
          ))}
          {mappings.length===0 && <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>No mappings — click "Add Row"</div>}
        </div>
        <div className="card">
          <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:14, display:'flex', alignItems:'center', gap:8 }}><Eye size={15} color="#06b6d4" /> Test Transformer (live preview)</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div>
              <div style={{ color:'var(--text-muted)', marginBottom:6 }}>Sample Input Record (JSON)</div>
              <textarea value={testRecord} onChange={e => setTestRecord(e.target.value)} rows={8} className="mono" style={{ width:'100%', resize:'vertical', background:'var(--bg-primary)', border:'1px solid #1e293b', borderRadius:8, padding:12, color:'var(--text-secondary)' }} />
            </div>
            <div>
              <div style={{ color:'var(--text-muted)', marginBottom:6 }}>Transformed Output</div>
              <div style={{ background:'var(--bg-primary)', borderRadius:8, padding:14, minHeight:160, border:'1px solid #1e293b' }}>
                {testResult ? <pre style={{ color:'#10b981', margin:0 }}>{JSON.stringify(testResult.output, null, 2)}</pre>
                  : <span style={{ color:'var(--text-secondary)' }}>Click "Run Test" to preview output…</span>}
              </div>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleTestMappings} style={{ marginTop:12 }}><Zap size={13} /> Run Test</button>
        </div>
      </div>
    );
  }

  // ── ACCOUNTS VIEW ──────────────────────────────────────────────────────────
  if (view === 'accounts') {
    const conn = selectedConnector;
    return (
      <div>
        <div className="page-header">
          <div><div className="page-title">Aggregated Accounts: {conn?.name}</div><div className="page-subtitle">Accounts pulled from target system into NexusIAM. Expand a row to view attributes and access.</div></div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-secondary" onClick={() => openAccounts(conn)}><RefreshCw size={14} /></button>
            <button className="btn btn-secondary" onClick={() => setView('list')}><X size={14} /> Close</button>
          </div>
        </div>
        <div className="card" style={{ padding:16, marginBottom:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:12 }}>
            <div><div style={{ color:'var(--text-muted)' }}>Accounts</div><div style={{ color:'var(--text-primary)', fontSize: 24, fontWeight:700 }}>{accountPagination.total || accountPreview.length}</div></div>
            <div><div style={{ color:'var(--text-muted)' }}>Linked</div><div style={{ color:'var(--text-primary)', fontSize: 24, fontWeight:700 }}>{accountPreview.filter(a => a.linked_email || a.linked_username).length}</div></div>
            <div><div style={{ color:'var(--text-muted)' }}>Unlinked</div><div style={{ color:'var(--text-primary)', fontSize: 24, fontWeight:700 }}>{accountPreview.filter(a => !a.linked_email && !a.linked_username).length}</div></div>
            <div><div style={{ color:'var(--text-muted)' }}>Access Items</div><div style={{ color:'var(--text-primary)', fontSize: 24, fontWeight:700 }}>{accountPreview.reduce((n, a) => n + Number(a.access_count || 0), 0)}</div></div>
          </div>
        </div>
        <div className="card" style={{ padding:0 }}>
          <table className="data-table">
            <thead><tr><th></th><th>Native Identity</th><th>Account Name</th><th>Email</th><th>Status</th><th>Access</th><th>Linked Identity</th><th>Last Aggregated</th></tr></thead>
            <tbody>
              {accountPreview.length === 0 ? <tr><td colSpan="8" style={{ color:'var(--text-secondary)' }}>No accounts aggregated yet. Run account aggregation first.</td></tr> : accountPreview.flatMap(a => {
                const isOpen = !!expandedAccounts[a.id];
                return [
                  <tr key={a.id}>
                    <td><button className="btn btn-secondary btn-sm" onClick={() => setExpandedAccounts(prev => ({ ...prev, [a.id]: !prev[a.id] }))}>{isOpen ? '−' : '+'}</button></td>
                    <td className="mono">{a.native_identity}</td>
                    <td>{a.display_name || a.account_name || '—'}</td>
                    <td>{a.email || '—'}</td>
                    <td><span className={`badge badge-${String(a.status || '').toLowerCase()==='active' ? 'success' : 'gray'}`}>{a.status || '—'}</span></td>
                    <td>{a.access_count || 0}</td>
                    <td>{a.linked_email || a.linked_username || 'Unlinked'}</td>
                    <td>{a.last_aggregated_at ? new Date(a.last_aggregated_at).toLocaleString() : '—'}</td>
                  </tr>,
                  isOpen ? <tr key={`${a.id}-detail`}><td colSpan="8" style={{ background:'var(--bg-primary)' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:16, padding:16 }}>
                      <div>
                        <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:8 }}>Account Attributes</div>
                        <div style={{ background:'var(--bg-primary)', border:'1px solid #1e293b', borderRadius:10, padding:12 }}>
                          {Object.entries(a.attributes || {}).length === 0 ? <div style={{ color:'var(--text-muted)' }}>No attributes stored</div> :
                            <table style={{ width:'100%' }}><tbody>{Object.entries(a.attributes || {}).map(([k,v]) => <tr key={k}><td style={{ color:'var(--text-secondary)', padding:'4px 8px 4px 0', verticalAlign:'top' }}>{k}</td><td style={{ color:'var(--text-secondary)', wordBreak:'break-word' }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>)}</tbody></table>}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:8 }}>Access / Entitlements</div>
                        <div style={{ background:'var(--bg-primary)', border:'1px solid #1e293b', borderRadius:10, padding:12, minHeight:120 }}>
                          {!(a.access_items || []).length ? <div style={{ color:'var(--text-muted)' }}>No access items discovered for this account.</div> :
                            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>{(a.access_items || []).map(item => <span key={item.id || `${item.type}-${item.value}`} className="badge badge-info">{item.type}: {item.display_name || item.value}</span>)}</div>}
                        </div>
                        <div style={{ marginTop:12, color:'var(--text-muted)' }}>Correlation: {a.correlation_value || '—'}</div>
                      </div>
                    </div>
                  </td></tr> : null,
                ].filter(Boolean);
              })}
            </tbody>
          </table>
          <PaginationControls
            page={accountPagination.page}
            pages={accountPagination.pages}
            limit={accountPagination.limit}
            total={accountPagination.total}
            onPageChange={(page) => loadAccounts(conn, page, accountPagination.limit)}
            onLimitChange={(limit) => loadAccounts(conn, 1, limit)}
          />
        </div>
      </div>
    );
  }

  // ── LIST VIEW ──────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Connectors</div><div className="page-subtitle">{connectors.length} configured — {totalTypes} types available in catalog</div></div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={fetchAll}><RefreshCw size={14} /></button>
          <button className="btn btn-primary" onClick={() => setView('catalog')}><Plus size={14} /> Add Connector</button>
        </div>
      </div>

      {connectors.length===0 ? (
        <div className="card" style={{ textAlign:'center', padding:60 }}>
          <GitMerge size={52} color="#1e293b" style={{ margin:'0 auto 16px', display:'block' }} />
          <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:8 }}>No connectors configured</div>
          <div style={{ color:'var(--text-muted)', marginBottom:8 }}>Connect to {totalTypes}+ identity sources and target applications</div>
          <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap', marginBottom:24 }}>
            {['Active Directory','Okta','Azure AD','Salesforce','SCIM 2.0','JDBC','Workday','ServiceNow'].map(n => (
              <span key={n} style={{ padding:'3px 10px', borderRadius:12, background:'var(--bg-tertiary)', color:'var(--text-secondary)' }}>{n}</span>
            ))}
            <span style={{ color:'var(--text-secondary)' }}>and 30+ more…</span>
          </div>
          <button className="btn btn-primary" onClick={() => setView('catalog')}><Plus size={14} /> Browse Connector Catalog</button>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:16 }}>
          {connectors.map(c => {
            const def = findDef(c.type);
            const catName = findCat(c.type);
            const cc = CAT_COLORS[catName] || 'var(--text-muted)';
            return (
              <div key={c.id} className="card">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:3 }}>{c.name}</div>
                    <div style={{ color:'var(--text-muted)' }}>{def?.displayName || c.type}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    {c.status==='connected' ? <Wifi size={14} color="#10b981" /> : <WifiOff size={14} color="#64748b" />}
                    <span className={`badge badge-${c.status==='connected'?'success':c.status==='error'?'danger':'gray'}`}>{c.status}</span>
                  </div>
                </div>
                <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
                  <span style={{ padding:'2px 8px', borderRadius:4, background:`${cc}20`, color:cc, fontWeight:600 }}>{catName||c.type}</span>
                  <span style={{ padding:'2px 8px', borderRadius:4, background:'var(--bg-tertiary)', color:'var(--text-secondary)' }}>
                    {c.provisioning_direction==='bidirectional'?'↔ Bidirectional':c.provisioning_direction==='push'?'→ Push':'← Pull'}
                  </span>
                  {c.sync_schedule && <span className="mono" style={{ padding:'2px 8px', borderRadius:4, background:'var(--bg-tertiary)', color:'var(--text-muted)' }}>{c.sync_schedule}</span>}
                  {c.sync_count>0 && <span style={{ padding:'2px 8px', borderRadius:4, background:'var(--bg-tertiary)', color:'var(--text-muted)' }}>{c.sync_count} syncs</span>}
                </div>
                {c.last_sync_at && (
                  <div style={{ color:'var(--text-secondary)', marginBottom:10 }}>
                    Last sync: {new Date(c.last_sync_at).toLocaleString()}
                    <span style={{ marginLeft:6, color:c.last_sync_status==='completed'?'#10b981':'#ef4444' }}>({c.last_sync_status})</span>
                  </div>
                )}
                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEditor(c)}>Open</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleTest(c.id)}>Test</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleSync(c)}>Sync Now</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => openSchema(c)}><Database size={11} /> Schema</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => openMapper(c)}><GitMerge size={11} /> Correlation & Mapping</button>
                  <button className="btn btn-danger btn-sm" onClick={() => { setDeleteTarget(c); setDeleteJustification(''); }}><Trash2 size={11} /> Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Connector Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Trash2 size={16} /> Delete Connector
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setDeleteTarget(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'var(--bg-tertiary)', border: '1px solid #ef444430', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                <div style={{ color: '#ef4444', fontWeight: 600, marginBottom: 6 }}>This action is irreversible</div>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Deleting <strong style={{ color: 'var(--text-primary)' }}>{deleteTarget.name}</strong> will permanently remove:
                  <ul style={{ marginTop: 8, paddingLeft: 20, color: 'var(--text-secondary)' }}>
                    <li>All aggregated accounts and account attributes</li>
                    <li>All sync jobs and run history</li>
                    <li>All discovered schema definitions</li>
                    <li>All attribute mappings and custom attributes</li>
                  </ul>
                </div>
              </div>
              <div className="form-group">
                <label>Business Justification <span style={{ color: '#ef4444' }}>*</span></label>
                <textarea
                  value={deleteJustification}
                  onChange={e => setDeleteJustification(e.target.value)}
                  rows={3}
                  placeholder="Why is this connector being deleted? (required for audit trail)"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteConnector}
                disabled={deleting || !deleteJustification.trim()}
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
