
import React, { useEffect, useState } from 'react';
import { Play, RefreshCw, Workflow } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

export default function LifecycleEventsPage() {
  const [defs, setDefs] = useState([]);
  const [runs, setRuns] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [form, setForm] = useState({ name:'', event_key:'joiner', description:'', trigger_source:'identity_change', workflow_id:'', enabled:true, trigger_conditions:'{}', config:'{}' });
  const [sim, setSim] = useState({ previous:'{}', current:`{
  "status": "active"
}` });
  const [simResult, setSimResult] = useState(null);
  const load = async () => {
    try {
      const [l, w] = await Promise.all([API.get('/lifecycle'), API.get('/studio/workflows')]);
      setDefs(l.data.definitions || []); setRuns(l.data.runs || []); setWorkflows(w.data || []);
    } catch { toast.error('Failed to load lifecycle events'); }
  };
  useEffect(() => { load(); }, []);
  const save = async (e) => {
    e.preventDefault();
    await API.post('/lifecycle', { ...form, trigger_conditions: JSON.parse(form.trigger_conditions || '{}'), config: JSON.parse(form.config || '{}') });
    toast.success('Lifecycle event saved');
    setForm({ name:'', event_key:'joiner', description:'', trigger_source:'identity_change', workflow_id:'', enabled:true, trigger_conditions:'{}', config:'{}' });
    load();
  };
  const run = async (id) => {
    await API.post(`/lifecycle/${id}/run`, { payload: { reason: 'manual-test' } });
    toast.success('Lifecycle event executed');
    load();
  };
  const simulate = async () => {
    const r = await API.post('/lifecycle/evaluate', { previous: JSON.parse(sim.previous || '{}'), current: JSON.parse(sim.current || '{}') });
    setSimResult(r.data);
  };

  return <div>
    <div className="page-header"><div><div className="page-title">Lifecycle Events</div><div className="page-subtitle">Joiner, Leaver, Mover, Rehire, NCD and custom JML events with workflow linkage</div></div></div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr', gap:16 }}>
      <div className="card">
        <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Add Lifecycle Event</div>
        <form onSubmit={save}>
          <div className="grid-2"><div className="form-group"><label>Name</label><input value={form.name} onChange={e=>setForm({ ...form, name:e.target.value })} /></div><div className="form-group"><label>Event Key</label><select value={form.event_key} onChange={e=>setForm({ ...form, event_key:e.target.value })}><option value="joiner">Joiner</option><option value="leaver">Leaver</option><option value="mover">Mover</option><option value="rehire">Rehire</option><option value="ncd">NCD</option><option value="custom">Custom</option></select></div></div>
          <div className="form-group"><label>Description</label><input value={form.description} onChange={e=>setForm({ ...form, description:e.target.value })} /></div>
          <div className="grid-2"><div className="form-group"><label>Trigger Source</label><input value={form.trigger_source} onChange={e=>setForm({ ...form, trigger_source:e.target.value })} /></div><div className="form-group"><label>Workflow</label><select value={form.workflow_id} onChange={e=>setForm({ ...form, workflow_id:e.target.value })}><option value="">Select workflow</option>{workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div></div>
          <div className="form-group"><label>Trigger Conditions (JSON)</label><textarea rows={3} value={form.trigger_conditions} onChange={e=>setForm({ ...form, trigger_conditions:e.target.value })} /></div>
          <div className="form-group"><label>Config (JSON)</label><textarea rows={3} value={form.config} onChange={e=>setForm({ ...form, config:e.target.value })} /></div>
          <button className="btn btn-primary" type="submit"><Workflow size={14} /> Save Lifecycle Event</button>
        </form>
      </div>
      <div className="card">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}><div style={{ fontWeight:700, color:'var(--text-primary)' }}>Configured Events</div><button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> Refresh</button></div>
        <table><thead><tr><th>Name</th><th>Key</th><th>Workflow</th><th>Status</th><th>Action</th></tr></thead><tbody>{defs.map(d => <tr key={d.id}><td>{d.name}</td><td>{d.event_key}</td><td>{d.workflow_name || '—'}</td><td><span className={`badge badge-${d.enabled?'success':'warning'}`}>{d.enabled ? 'Enabled' : 'Disabled'}</span></td><td><button className="btn btn-primary" onClick={() => run(d.id)}><Play size={14} /> Run</button></td></tr>)}{defs.length===0 && <tr><td colSpan={5} style={{ textAlign:'center', color:'var(--text-muted)', padding:30 }}>No lifecycle events yet.</td></tr>}</tbody></table>
      </div>
    </div>
    <div className="card" style={{ marginTop:16 }}>
      <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Lifecycle Decision Simulator</div>
      <div style={{ color:'var(--text-secondary)', marginBottom:12 }}>Use this to see how HR changes become Joiner, Leaver, Mover, Rehire, or NCD events. In production, aggregation compares the latest source record with the last known identity state and then launches the linked workflow.</div>
      <div className="grid-2">
        <div className="form-group"><label>Previous Identity Snapshot (JSON)</label><textarea rows={6} value={sim.previous} onChange={e=>setSim({ ...sim, previous:e.target.value })} /></div>
        <div className="form-group"><label>Current HR Snapshot (JSON)</label><textarea rows={6} value={sim.current} onChange={e=>setSim({ ...sim, current:e.target.value })} /></div>
      </div>
      <button className="btn btn-primary" onClick={simulate}><Play size={14} /> Evaluate Transition</button>
      {simResult && <div style={{ marginTop:12, padding:12, border:'1px solid #1e293b', borderRadius:8, background:'var(--bg-primary)' }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>Detected Event: {simResult.event_key}</div><div style={{ color:'var(--text-secondary)', marginTop:6 }}>{simResult.explanation}</div><div style={{ color:'var(--text-muted)', marginTop:6 }}>Matched lifecycle definitions: {(simResult.matchedDefinitions || []).map(d => d.name).join(', ') || 'none'}</div></div>}
    </div>

    <div className="card" style={{ marginTop:16 }}>
      <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Recent Lifecycle Runs</div>
      <table><thead><tr><th>Event</th><th>Subject</th><th>Status</th><th>Time</th></tr></thead><tbody>{runs.map(r => <tr key={r.id}><td>{r.event_name}</td><td>{r.subject_name || 'Simulation'}</td><td><span className={`badge badge-${r.status==='completed'?'success':'danger'}`}>{r.status}</span></td><td>{new Date(r.created_at).toLocaleString()}</td></tr>)}{runs.length===0 && <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--text-muted)', padding:30 }}>No runs yet.</td></tr>}</tbody></table>
    </div>
  </div>;
}
