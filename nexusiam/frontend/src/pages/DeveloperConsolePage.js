import React, { useEffect, useMemo, useState } from 'react';
import { Blocks, Code2, LayoutPanelLeft, Package, Play, ScrollText, Wrench } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

const starterForm = {
  name: '',
  description: '',
  category: 'request',
  schema: { type: 'object', properties: { targetUser: { type: 'string' }, justification: { type: 'string' } }, required: ['targetUser'] },
  ui_schema: { order: ['targetUser', 'justification'] },
  validation_rules: ['targetUser_required'],
};

const starterPage = {
  name: '',
  route_path: '/quick/custom-page',
  title: 'Custom Page',
  description: '',
  icon: 'Layout',
  page_type: 'custom',
  page_config: { layout: 'single-column', cards: [] },
  required_permissions: ['REQUEST_ACCESS'],
};

const starterPlugin = {
  name: '',
  version: '1.0.0',
  status: 'draft',
  package_type: 'metadata',
  manifest: { author: 'Tenant Admin', description: 'Custom extension package' },
  capabilities: ['quicklink'],
  routes: [{ path: '/quick/custom-page', title: 'Custom Page' }],
  extension_points: ['access_request.created'],
};

const starterLogger = {
  logger_name: 'tenant.custom.logger',
  level: 'debug',
  target_type: 'application',
  pattern: '%timestamp% [%level%] %message%',
  config: { capturePayload: true, maskSecrets: true },
};

export default function DeveloperConsolePage() {
  const [summary, setSummary] = useState({});
  const [forms, setForms] = useState([]);
  const [pages, setPages] = useState([]);
  const [plugins, setPlugins] = useState([]);
  const [loggers, setLoggers] = useState([]);
  const [hooks, setHooks] = useState([]);
  const [scriptCode, setScriptCode] = useState('if (!input.justification) { return { allowed: false, reason: "Justification required" }; } return { allowed: true, route: "STANDARD" };');
  const [scriptInput, setScriptInput] = useState('{"justification":"Need emergency access"}');
  const [scriptResult, setScriptResult] = useState(null);
  const [tab, setTab] = useState('overview');
  const [formDraft, setFormDraft] = useState(starterForm);
  const [pageDraft, setPageDraft] = useState(starterPage);
  const [pluginDraft, setPluginDraft] = useState(starterPlugin);
  const [loggerDraft, setLoggerDraft] = useState(starterLogger);

  const load = async () => {
    try {
      const [s, f, p, pl, lg, hk] = await Promise.all([
        API.get('/developer-console/summary'),
        API.get('/developer-console/forms'),
        API.get('/developer-console/ui-pages'),
        API.get('/developer-console/plugins'),
        API.get('/developer-console/loggers'),
        API.get('/developer-console/hooks'),
      ]);
      setSummary(s.data || {});
      setForms(f.data || []);
      setPages(p.data || []);
      setPlugins(pl.data || []);
      setLoggers(lg.data || []);
      setHooks(hk.data || []);
    } catch {
      toast.error('Failed to load developer console');
    }
  };

  useEffect(() => { load(); }, []);

  const cards = useMemo(() => ([
    { label: 'Forms', value: summary.forms || 0, icon: Blocks },
    { label: 'UI Pages', value: summary.uiPages || 0, icon: LayoutPanelLeft },
    { label: 'Plugins', value: summary.plugins || 0, icon: Package },
    { label: 'Logger Profiles', value: summary.loggers || 0, icon: ScrollText },
    { label: 'Hooks', value: summary.hooks || 0, icon: Wrench },
  ]), [summary]);

  const saveJsonEntity = async (endpoint, payload, successMessage, reset) => {
    try {
      await API.post(endpoint, payload);
      toast.success(successMessage);
      reset();
      load();
    } catch {
      toast.error(`Failed to save ${successMessage.toLowerCase()}`);
    }
  };

  const executeScript = async () => {
    try {
      const parsed = JSON.parse(scriptInput || '{}');
      const { data } = await API.post('/developer-console/script-console/execute', { code: scriptCode, input: parsed });
      setScriptResult(data);
      toast.success('Script executed');
    } catch (e) {
      toast.error('Script execution failed');
      setScriptResult({ error: e.message });
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Developer Console</div>
          <div className="page-subtitle">Tenant-safe extension surface for forms, UI pages, plugins, hooks, logger profiles, and sandboxed scripts.</div>
        </div>
        <button className="btn btn-secondary" onClick={load}>Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
        {cards.map(c => <div key={c.label} className="card"><div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}><div><div style={{ color:'var(--text-muted)' }}>{c.label}</div><div style={{ color:'var(--text-primary)', fontSize: 24, fontWeight:700 }}>{c.value}</div></div><c.icon size={18} color="#06b6d4" /></div></div>)}
      </div>

      <div className="tabs" style={{ flexWrap:'wrap' }}>
        {['overview','forms','pages','plugins','loggers','hooks','script-console'].map(t => <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>{t === 'script-console' ? 'Script Console' : t.charAt(0).toUpperCase()+t.slice(1)}</button>)}
      </div>

      {tab === 'overview' && (
        <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:16 }}>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:10 }}>Why this matters</div>
            <div style={{ color:'var(--text-secondary)', lineHeight:1.7 }}>
              This page is the answer to the “how can my customer build like SailPoint without server access?” question. Tenant admins can define forms, attach hooks, register metadata plugins, configure loggers, and create UI pages without touching infrastructure.
            </div>
          </div>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:10 }}>Current sample capabilities</div>
            <div style={{ color:'var(--text-secondary)', lineHeight:1.8 }}>
              Dynamic request forms<br />
              Quick page metadata<br />
              Plugin registry<br />
              Logger profiles with masking options<br />
              Extension hooks and sandboxed script console
            </div>
          </div>
        </div>
      )}

      {tab === 'forms' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Create Form Definition</div>
            <div className="form-group"><label>Name</label><input value={formDraft.name} onChange={e=>setFormDraft({...formDraft, name:e.target.value})} /></div>
            <div className="form-group"><label>Description</label><input value={formDraft.description} onChange={e=>setFormDraft({...formDraft, description:e.target.value})} /></div>
            <div className="form-group"><label>Schema JSON</label><textarea rows={10} className="mono" value={JSON.stringify(formDraft.schema, null, 2)} onChange={e=>{ try { setFormDraft({...formDraft, schema: JSON.parse(e.target.value)}); } catch {} }} /></div>
            <button className="btn btn-primary" onClick={() => saveJsonEntity('/developer-console/forms', formDraft, 'Form saved', () => setFormDraft(starterForm))}>Save Form</button>
          </div>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Existing Forms</div>
            {forms.map(item => <div key={item.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{item.name}</div><div style={{ color:'var(--text-muted)' }}>{item.category} · {item.enabled ? 'enabled' : 'disabled'}</div></div>)}
          </div>
        </div>
      )}

      {tab === 'pages' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Create UI Page</div>
            <div className="form-group"><label>Name</label><input value={pageDraft.name} onChange={e=>setPageDraft({...pageDraft, name:e.target.value})} /></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div className="form-group"><label>Route</label><input value={pageDraft.route_path} onChange={e=>setPageDraft({...pageDraft, route_path:e.target.value})} /></div>
              <div className="form-group"><label>Title</label><input value={pageDraft.title} onChange={e=>setPageDraft({...pageDraft, title:e.target.value})} /></div>
            </div>
            <div className="form-group"><label>Page Config JSON</label><textarea rows={10} className="mono" value={JSON.stringify(pageDraft.page_config, null, 2)} onChange={e=>{ try { setPageDraft({...pageDraft, page_config: JSON.parse(e.target.value)}); } catch {} }} /></div>
            <button className="btn btn-primary" onClick={() => saveJsonEntity('/developer-console/ui-pages', pageDraft, 'UI page saved', () => setPageDraft(starterPage))}>Save UI Page</button>
          </div>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Registered Pages</div>
            {pages.map(item => <div key={item.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{item.title}</div><div style={{ color:'var(--text-muted)' }}>{item.route_path} · {item.page_type}</div></div>)}
          </div>
        </div>
      )}

      {tab === 'plugins' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Register Plugin Package</div>
            <div className="form-group"><label>Name</label><input value={pluginDraft.name} onChange={e=>setPluginDraft({...pluginDraft, name:e.target.value})} /></div>
            <div className="form-group"><label>Manifest JSON</label><textarea rows={7} className="mono" value={JSON.stringify(pluginDraft.manifest, null, 2)} onChange={e=>{ try { setPluginDraft({...pluginDraft, manifest: JSON.parse(e.target.value)}); } catch {} }} /></div>
            <div className="form-group"><label>Capabilities JSON</label><textarea rows={5} className="mono" value={JSON.stringify(pluginDraft.capabilities, null, 2)} onChange={e=>{ try { setPluginDraft({...pluginDraft, capabilities: JSON.parse(e.target.value)}); } catch {} }} /></div>
            <button className="btn btn-primary" onClick={() => saveJsonEntity('/developer-console/plugins', pluginDraft, 'Plugin saved', () => setPluginDraft(starterPlugin))}>Save Plugin</button>
          </div>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Plugin Registry</div>
            {plugins.map(item => <div key={item.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{item.name}</div><div style={{ color:'var(--text-muted)' }}>{item.version} · {item.status} · {item.package_type}</div></div>)}
          </div>
        </div>
      )}

      {tab === 'loggers' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Logger Profile</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 120px', gap:12 }}>
              <div className="form-group"><label>Logger Name</label><input value={loggerDraft.logger_name} onChange={e=>setLoggerDraft({...loggerDraft, logger_name:e.target.value})} /></div>
              <div className="form-group"><label>Level</label><input value={loggerDraft.level} onChange={e=>setLoggerDraft({...loggerDraft, level:e.target.value})} /></div>
            </div>
            <div className="form-group"><label>Config JSON</label><textarea rows={8} className="mono" value={JSON.stringify(loggerDraft.config, null, 2)} onChange={e=>{ try { setLoggerDraft({...loggerDraft, config: JSON.parse(e.target.value)}); } catch {} }} /></div>
            <button className="btn btn-primary" onClick={() => saveJsonEntity('/developer-console/loggers', loggerDraft, 'Logger saved', () => setLoggerDraft(starterLogger))}>Save Logger</button>
          </div>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Logger Profiles</div>
            {loggers.map(item => <div key={item.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{item.logger_name}</div><div style={{ color:'var(--text-muted)' }}>{item.level} · {item.target_type}</div></div>)}
          </div>
        </div>
      )}

      {tab === 'hooks' && (
        <div className="card">
          <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Extension Hooks</div>
          {hooks.map(item => <div key={item.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{item.hook_key}</div><div style={{ color:'var(--text-muted)' }}>{item.hook_type} · {item.execution_mode} · {item.enabled ? 'enabled' : 'disabled'}</div></div>)}
        </div>
      )}

      {tab === 'script-console' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Sandboxed Rule Console</div>
            <div className="form-group"><label>Code</label><textarea rows={12} className="mono" value={scriptCode} onChange={e=>setScriptCode(e.target.value)} /></div>
            <div className="form-group"><label>Input JSON</label><textarea rows={8} className="mono" value={scriptInput} onChange={e=>setScriptInput(e.target.value)} /></div>
            <button className="btn btn-primary" onClick={executeScript}><Play size={14} /> Run</button>
          </div>
          <div className="card">
            <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:12 }}>Execution Result</div>
            <pre style={{ margin:0, background:'var(--bg-primary)', border:'1px solid #1e293b', padding:12, borderRadius:10, overflow:'auto', color:'var(--border-bright)' }}>{JSON.stringify(scriptResult, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
