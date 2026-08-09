import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, Blocks, CheckCircle2, Code2, Mail, Play, Plus, Rocket, Workflow } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

const emptyWorkflow = {
  name: '',
  description: '',
  category: 'governance',
  trigger_type: 'manual',
  steps: [
    { name: 'Manager Approval', type: 'APPROVAL', assigneeType: 'role', assigneeValue: 'IAM Admin' },
    { name: 'Notify', type: 'SEND_EMAIL', template: 'access_request_approval', recipientMode: 'assignee' },
    { name: 'Provision', type: 'PROVISION', operation: 'role_grant' },
  ],
};

const emptyScript = {
  name: '',
  description: '',
  entry_type: 'workflow_rule',
  language: 'javascript',
  code: 'return { allowed: true, message: "ok" };',
  test_input: { priority: 'medium' },
};

const emptyQuickLink = {
  name: '',
  icon: 'Zap',
  route: '/access-requests',
  action_type: 'navigate',
  enabled: true,
  sort_order: 100,
};

const emptyProvider = {
  name: '', provider_type: 'smtp', from_email: '', from_name: 'NexusIAM', smtp_host: '', smtp_port: 587, secure: false,
};

export default function PlatformStudioPage() {
  const [summary, setSummary] = useState({});
  const [providers, setProviders] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [quicklinks, setQuicklinks] = useState([]);
  const [workItems, setWorkItems] = useState([]);
  const [taskRuns, setTaskRuns] = useState([]);
  const [provisioning, setProvisioning] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [workflowForm, setWorkflowForm] = useState(emptyWorkflow);
  const [scriptForm, setScriptForm] = useState(emptyScript);
  const [quickLinkForm, setQuickLinkForm] = useState(emptyQuickLink);
  const [providerForm, setProviderForm] = useState(emptyProvider);
  const [simulation, setSimulation] = useState(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [scriptResult, setScriptResult] = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [s, p, t, w, sc, q, wi, tr, pt] = await Promise.all([
        API.get('/studio/summary'),
        API.get('/studio/email/providers'),
        API.get('/studio/email/templates'),
        API.get('/studio/workflows'),
        API.get('/studio/scripts'),
        API.get('/studio/quicklinks'),
        API.get('/studio/work-items'),
        API.get('/studio/task-runs'),
        API.get('/studio/provisioning-transactions'),
      ]);
      setSummary(s.data || {});
      setProviders(p.data || []);
      setTemplates(t.data || []);
      setWorkflows(w.data || []);
      setScripts(sc.data || []);
      setQuicklinks(q.data || []);
      setWorkItems(wi.data || []);
      setTaskRuns(tr.data || []);
      setProvisioning(pt.data || []);
      setSelectedWorkflowId(w.data?.[0]?.id || '');
    } catch (e) {
      toast.error('Failed to load platform studio');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const cards = useMemo(() => [
    { label: 'Workflows', value: summary.workflows || 0, icon: Workflow },
    { label: 'Scripts', value: summary.scripts || 0, icon: Code2 },
    { label: 'Quick Links', value: summary.quicklinks || 0, icon: Blocks },
    { label: 'Pending Approvals', value: summary.workItems || 0, icon: BellRing },
    { label: 'Task Runs', value: summary.tasks || 0, icon: CheckCircle2 },
    { label: 'Provisioning', value: summary.provisioning || 0, icon: Rocket },
  ], [summary]);

  const saveProvider = async (e) => {
    e.preventDefault();
    try { await API.post('/studio/email/providers', providerForm); toast.success('Email provider added'); setProviderForm(emptyProvider); fetchAll(); }
    catch { toast.error('Failed to save provider'); }
  };

  const saveWorkflow = async (e) => {
    e.preventDefault();
    try { await API.post('/studio/workflows', workflowForm); toast.success('Workflow saved'); setWorkflowForm(emptyWorkflow); fetchAll(); }
    catch { toast.error('Failed to save workflow'); }
  };

  const simulateWorkflow = async () => {
    if (!selectedWorkflowId) return toast.error('Choose a workflow');
    try {
      const { data } = await API.post(`/studio/workflows/${selectedWorkflowId}/simulate`, { priority: 'critical', businessJustification: 'Finance onboarding' });
      setSimulation(data.execution || []);
      toast.success('Workflow simulation complete');
    } catch { toast.error('Simulation failed'); }
  };

  const saveScript = async (e) => {
    e.preventDefault();
    try { await API.post('/studio/scripts', scriptForm); toast.success('Script saved'); setScriptForm(emptyScript); fetchAll(); }
    catch { toast.error('Failed to save script'); }
  };

  const testScript = async (id) => {
    try {
      const { data } = await API.post(`/studio/scripts/${id}/test`, { input: { priority: 'critical', businessJustification: '' } });
      setScriptResult(data.result);
      toast.success('Script executed');
    } catch { toast.error('Script execution failed'); }
  };

  const saveQuickLink = async (e) => {
    e.preventDefault();
    try { const payload = { ...quickLinkForm, required_capabilities: (quickLinkForm.required_capabilities_text || '').split(',').map(s => s.trim()).filter(Boolean) }; await API.post('/studio/quicklinks', payload); toast.success('Quick link saved'); setQuickLinkForm(emptyQuickLink); fetchAll(); }
    catch { toast.error('Failed to save quick link'); }
  };

  const actOnWorkItem = async (id, action) => {
    try { await API.post(`/studio/work-items/${id}/action`, { action }); toast.success(`Work item ${action}d`); fetchAll(); }
    catch { toast.error('Failed to update work item'); }
  };

  const statusBadge = (s) => ({ padding: '2px 8px', borderRadius: 999, fontWeight: 600, background: s === 'failed' || s === 'rejected' ? 'rgba(239,68,68,.14)' : s === 'pending' || s === 'queued' ? 'rgba(245,158,11,.14)' : 'rgba(16,185,129,.14)', color: s === 'failed' || s === 'rejected' ? '#f87171' : s === 'pending' || s === 'queued' ? '#fbbf24' : '#34d399' });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Platform Studio</div>
          <div className="page-subtitle">Metadata-driven workflows, scripts, quick links, approvals, email providers, and operational diagnostics.</div>
        </div>
        <button className="btn btn-secondary" onClick={fetchAll}>Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
        {cards.map(c => <div key={c.label} className="card"><div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}><div><div style={{ color:'var(--text-muted)' }}>{c.label}</div><div style={{ color:'var(--text-primary)', fontSize: 24, fontWeight:700 }}>{c.value}</div></div><c.icon size={18} color="#06b6d4" /></div></div>)}
      </div>

      <div className="tabs" style={{ flexWrap:'wrap' }}>
        {['overview','email','workflows','scripts','quicklinks','approvals','operations'].map(t => <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>{t === 'quicklinks' ? 'Quick Links' : t.charAt(0).toUpperCase()+t.slice(1)}</button>)}
      </div>

      {loading ? <div className="card">Loading...</div> : (
        <>
          {tab === 'overview' && (
            <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:16 }}>
              <div className="card">
                <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:10 }}>Why this is here</div>
                <div style={{ color:'var(--text-secondary)', lineHeight:1.7 }}>
                  This studio moves the project away from hardcoded Docker-only behavior. Email providers, templates, workflow definitions, script rules, quick links, work items, task runs, and provisioning transactions are now stored as runtime metadata.
                </div>
              </div>
              <div className="card">
                <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:10 }}>Current runtime</div>
                <div style={{ color:'var(--text-secondary)', lineHeight:1.8 }}>
                  {summary.providers || 0} email provider(s)<br />
                  {summary.myApprovals || 0} approvals assigned to current user<br />
                  {summary.tasks || 0} task runs captured<br />
                  {summary.provisioning || 0} provisioning transactions captured
                </div>
              </div>
            </div>
          )}

          {tab === 'email' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div className="card">
                <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Email Providers</div>
                <form onSubmit={saveProvider}>
                  <div className="form-group"><label>Name</label><input value={providerForm.name} onChange={e=>setProviderForm({...providerForm, name:e.target.value})} required /></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div className="form-group"><label>From Email</label><input value={providerForm.from_email} onChange={e=>setProviderForm({...providerForm, from_email:e.target.value})} required /></div>
                    <div className="form-group"><label>From Name</label><input value={providerForm.from_name} onChange={e=>setProviderForm({...providerForm, from_name:e.target.value})} /></div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 110px', gap:12 }}>
                    <div className="form-group"><label>SMTP Host</label><input value={providerForm.smtp_host} onChange={e=>setProviderForm({...providerForm, smtp_host:e.target.value})} required /></div>
                    <div className="form-group"><label>Port</label><input type="number" value={providerForm.smtp_port} onChange={e=>setProviderForm({...providerForm, smtp_port:Number(e.target.value)})} /></div>
                  </div>
                  <button className="btn btn-primary" type="submit"><Plus size={14} /> Add Provider</button>
                </form>
                <div style={{ marginTop:16 }}>{providers.map(p => <div key={p.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{p.name}</div><div style={{ color:'var(--text-muted)' }}>{p.provider_type} · {p.smtp_host}:{p.smtp_port} · {p.from_email}</div></div>)}</div>
              </div>
              <div className="card">
                <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Templates</div>
                {templates.length === 0 ? <div style={{ color:'var(--text-muted)' }}>No templates yet.</div> : templates.map(t => <div key={t.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{t.template_key}</div><div style={{ color:'var(--text-secondary)' }}>{t.subject}</div></div>)}
              </div>
            </div>
          )}

          {tab === 'workflows' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div className="card">
                <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Create Workflow</div>
                <form onSubmit={saveWorkflow}>
                  <div className="form-group"><label>Name</label><input value={workflowForm.name} onChange={e=>setWorkflowForm({...workflowForm, name:e.target.value})} required /></div>
                  <div className="form-group"><label>Description</label><textarea rows={3} value={workflowForm.description} onChange={e=>setWorkflowForm({...workflowForm, description:e.target.value})} /></div>
                  <div className="form-group"><label>Steps JSON</label><textarea rows={10} className="mono" value={JSON.stringify(workflowForm.steps, null, 2)} onChange={e=>{ try { setWorkflowForm({...workflowForm, steps: JSON.parse(e.target.value)}); } catch {} }} /></div>
                  <button className="btn btn-primary" type="submit"><Plus size={14} /> Save Workflow</button>
                </form>
              </div>
              <div className="card">
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12, alignItems:'center' }}>
                  <div style={{ fontWeight:700, color:'var(--text-primary)' }}>Workflow Definitions</div>
                  <div style={{ display:'flex', gap:8 }}>
                    <select value={selectedWorkflowId} onChange={e=>setSelectedWorkflowId(e.target.value)} style={{ width:220 }}>
                      <option value="">Choose workflow</option>
                      {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <button className="btn btn-secondary" onClick={simulateWorkflow}><Play size={14} /> Simulate</button>
                  </div>
                </div>
                {workflows.map(w => <div key={w.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{w.name}</div><div style={{ color:'var(--text-muted)' }}>{w.steps?.length || 0} step(s) · {w.trigger_type}</div></div>)}
                {simulation && <pre style={{ marginTop:12, background:'var(--bg-primary)', border:'1px solid #1e293b', padding:12, borderRadius:10, overflow:'auto', color:'var(--border-bright)' }}>{JSON.stringify(simulation, null, 2)}</pre>}
              </div>
            </div>
          )}

          {tab === 'scripts' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div className="card">
                <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Script Rule</div>
                <form onSubmit={saveScript}>
                  <div className="form-group"><label>Name</label><input value={scriptForm.name} onChange={e=>setScriptForm({...scriptForm, name:e.target.value})} required /></div>
                  <div className="form-group"><label>Description</label><input value={scriptForm.description} onChange={e=>setScriptForm({...scriptForm, description:e.target.value})} /></div>
                  <div className="form-group"><label>Code</label><textarea rows={10} className="mono" value={scriptForm.code} onChange={e=>setScriptForm({...scriptForm, code:e.target.value})} /></div>
                  <button className="btn btn-primary" type="submit"><Code2 size={14} /> Save Script</button>
                </form>
              </div>
              <div className="card">
                <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Available Scripts</div>
                {scripts.map(s => <div key={s.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b', display:'flex', justifyContent:'space-between', gap:10 }}><div><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{s.name}</div><div style={{ color:'var(--text-muted)' }}>{s.entry_type}</div></div><button className="btn btn-secondary btn-sm" onClick={()=>testScript(s.id)}>Test</button></div>)}
                {scriptResult && <pre style={{ marginTop:12, background:'var(--bg-primary)', border:'1px solid #1e293b', padding:12, borderRadius:10, overflow:'auto', color:'var(--border-bright)' }}>{JSON.stringify(scriptResult, null, 2)}</pre>}
              </div>
            </div>
          )}

          {tab === 'quicklinks' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div className="card">
                <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Quick Link Metadata</div>
                <form onSubmit={saveQuickLink}>
                  <div className="form-group"><label>Name</label><input value={quickLinkForm.name} onChange={e=>setQuickLinkForm({...quickLinkForm, name:e.target.value})} required /></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div className="form-group"><label>Route</label><input value={quickLinkForm.route} onChange={e=>setQuickLinkForm({...quickLinkForm, route:e.target.value})} /></div>
                    <div className="form-group"><label>Action</label><select value={quickLinkForm.action_type} onChange={e=>setQuickLinkForm({...quickLinkForm, action_type:e.target.value})}><option value="navigate">navigate</option><option value="launch_workflow">launch_workflow</option></select></div>
                  </div>
                  <div className="form-group"><label>Required Capabilities (comma separated)</label><input placeholder="approvals.work, lifecycle.manage" value={quickLinkForm.required_capabilities_text || ''} onChange={e=>setQuickLinkForm({...quickLinkForm, required_capabilities_text:e.target.value})} /></div>
                  <button className="btn btn-primary" type="submit"><Blocks size={14} /> Save Quick Link</button>
                </form>
              </div>
              <div className="card">
                <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Configured Quick Links</div>
                {quicklinks.map(q => <div key={q.id} style={{ padding:'10px 0', borderTop:'1px solid #1e293b' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{q.name}</div><div style={{ color:'var(--text-muted)' }}>{q.action_type} · {q.route}</div></div>)}
              </div>
            </div>
          )}

          {tab === 'approvals' && (
            <div className="card" style={{ padding:0 }}>
              <table>
                <thead><tr><th>Title</th><th>Assignee</th><th>Reference</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
                <tbody>
                  {workItems.length === 0 ? <tr><td colSpan={6} style={{ textAlign:'center', padding:40 }}>No work items yet</td></tr> : workItems.map(w => (
                    <tr key={w.id}>
                      <td>{w.title}</td><td>{w.assignee_name || 'Unassigned'}</td><td>{w.ticket_number || w.reference_type}</td>
                      <td><span style={statusBadge(w.status)}>{w.status}</span></td>
                      <td>{w.due_at ? new Date(w.due_at).toLocaleString() : '—'}</td>
                      <td style={{ display:'flex', gap:8 }}>
                        {w.status === 'pending' && <><button className="btn btn-secondary btn-sm" onClick={()=>actOnWorkItem(w.id,'approve')}>Approve</button><button className="btn btn-secondary btn-sm" onClick={()=>actOnWorkItem(w.id,'reject')}>Reject</button></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'operations' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div className="card" style={{ padding:0 }}>
                <table>
                  <thead><tr><th>Task</th><th>Type</th><th>Status</th><th>Started</th></tr></thead>
                  <tbody>
                    {taskRuns.length === 0 ? <tr><td colSpan={4} style={{ textAlign:'center', padding:40 }}>No task runs</td></tr> : taskRuns.map(t => <tr key={t.id}><td>{t.task_name}</td><td>{t.task_type}</td><td><span style={statusBadge(t.status)}>{t.status}</span></td><td>{new Date(t.started_at).toLocaleString()}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div className="card" style={{ padding:0 }}>
                <table>
                  <thead><tr><th>Operation</th><th>Status</th><th>Created</th><th>Error</th></tr></thead>
                  <tbody>
                    {provisioning.length === 0 ? <tr><td colSpan={4} style={{ textAlign:'center', padding:40 }}>No provisioning transactions</td></tr> : provisioning.map(p => <tr key={p.id}><td>{p.operation}</td><td><span style={statusBadge(p.status)}>{p.status}</span></td><td>{new Date(p.created_at).toLocaleString()}</td><td style={{ maxWidth:240, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.error_message || '—'}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
