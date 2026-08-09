import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Users, Shield, AppWindow, ClipboardList, AlertTriangle, CheckSquare, TrendingUp, Activity, Zap, ArrowRight } from 'lucide-react';
import API from '../utils/api';

const StatCard = ({ label, value, sub, icon: Icon, color, trend }) => (
  <div className={`stat-card ${color}`}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div>
        <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>{label}</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1 }}>{value ?? '—'}</div>
        {sub && <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>}
      </div>
      <div style={{ padding: 10, borderRadius: 10, background: 'rgba(255,255,255,0.04)' }}>
        <Icon size={20} color="#94a3b8" />
      </div>
    </div>
  </div>
);

const COLORS = ['#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [launchpad, setLaunchpad] = useState([]);

  useEffect(() => {
    Promise.allSettled([API.get('/dashboard'), API.get('/studio/launchpad')])
      .then(([dash, lp]) => {
        if (dash.status === 'fulfilled') setData(dash.value.data);
        else setData({ stats: { users: { total: 0, active: 0 }, roles: 0, applications: 0, requests: { total: 0, pending: 0 }, violations: 0, activeCertifications: 0 }, requestsByDay: [], usersByStatus: [], recentActivity: [] });
        if (lp.status === 'fulfilled') setLaunchpad(lp.value.data || []);
        else setLaunchpad([]);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div className="loading-spinner" style={{ width: 32, height: 32 }} />
    </div>
  );

  const s = data?.stats || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Identity & Access Management Overview</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
          <Activity size={14} />
          Live
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Users" value={s.users?.total} sub={`${s.users?.active} active`} icon={Users} color="cyan" />
        <StatCard label="Roles" value={s.roles} sub="defined" icon={Shield} color="purple" />
        <StatCard label="Applications" value={s.applications} sub="connected" icon={AppWindow} color="green" />
        <StatCard label="Pending Requests" value={s.requests?.pending} sub={`${s.requests?.total} total`} icon={ClipboardList} color="orange" />
        <StatCard label="SoD Violations" value={s.violations} sub="open" icon={AlertTriangle} color="red" />
        <StatCard label="Active Campaigns" value={s.activeCertifications} sub="certifications" icon={CheckSquare} color="cyan" />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Requests by day */}
        <div className="card">
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingUp size={16} color="#06b6d4" /> Access Requests (30 days)
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data?.requestsByDay || []}>
              <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)' }} tickFormatter={v => v?.slice(5)} />
              <YAxis tick={{ fill: 'var(--text-muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid #334155', borderRadius: 8 }} />
              <Bar dataKey="count" fill="#06b6d4" radius={[4,4,0,0]} name="Requests" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Users by status */}
        <div className="card">
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 20 }}>Users by Status</div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={data?.usersByStatus || []} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={50} outerRadius={75}>
                {(data?.usersByStatus || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid #334155', borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {(data?.usersByStatus || []).map((s, i) => (
              <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length] }} />
                <span style={{ color: 'var(--text-secondary)' }}>{s.status} ({s.count})</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16, display:'flex', alignItems:'center', gap:8 }}><Zap size={16} color="#06b6d4" /> Quick Launch</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12 }}>
          {launchpad.map(item => (
            <a key={item.id} href={item.route || '#'} style={{ textDecoration:'none', padding:16, border:'1px solid #1e293b', borderRadius:12, background:'var(--bg-secondary)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}><div style={{ color:'var(--text-primary)', fontWeight:600 }}>{item.name}</div><ArrowRight size={14} color="#64748b" /></div>
              <div style={{ color:'var(--text-muted)' }}>{item.action_type} • {item.route || 'workflow launch'}</div>
            </a>
          ))}
          {launchpad.length === 0 && <div style={{ color:'var(--text-muted)' }}>No launchpad items visible for your capabilities yet.</div>}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>Recent Audit Activity</div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Resource</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentActivity || []).slice(0, 10).map((item, i) => (
                <tr key={i}>
                  <td className="mono" style={{ color: '#06b6d4' }}>{item.action}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{item.resource_type || '—'}</td>
                  <td>
                    <span className={`badge badge-${item.status === 'success' ? 'success' : 'danger'}`}>{item.status}</span>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
              {(!data?.recentActivity?.length) && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 40 }}>No recent activity</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
