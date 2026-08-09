import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, Download, RefreshCw, Table, Zap, Database, Shield,
  TrendingUp, Users, AlertTriangle, CheckCircle, Clock, Activity,
  ChevronDown, ChevronUp, ExternalLink, Copy } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

// ─── Color palette ────────────────────────────────────────────────────────────
const C = { cyan: '#06b6d4', purple: '#8b5cf6', green: '#10b981', amber: '#f59e0b', red: '#ef4444', slate: 'var(--text-muted)' };

// ─── Simple bar chart (no external library needed) ───────────────────────────
function MiniBar({ data, labelKey, valueKey, color = C.cyan, height = 140 }) {
  if (!data || !data.length) return null;
  const max = Math.max(...data.map(d => parseFloat(d[valueKey]) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height, padding: '8px 0' }}>
      {data.slice(0, 12).map((d, i) => {
        const val = parseFloat(d[valueKey]) || 0;
        const pct = max > 0 ? (val / max) * 100 : 0;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{val > 999 ? `${(val/1000).toFixed(1)}k` : val}</div>
            <div title={`${d[labelKey]}: ${val}`} style={{ width: '100%', height: `${Math.max(pct, 2)}%`, background: color, borderRadius: '3px 3px 0 0', opacity: 0.85 }} />
            <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{String(d[labelKey]).slice(0, 8)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPI({ label, value, sub, color = C.cyan, icon: Icon }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        {Icon && <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={16} color={color} /></div>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{value ?? '—'}</div>
      {sub && <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ─── Report definitions ───────────────────────────────────────────────────────
const REPORTS = [
  { id: 'user-access',         label: 'User Access Summary',       icon: Users,         color: C.cyan,   description: 'All users with roles, last login, violations. Core IAM visibility.',          endpoint: '/reports/user-access' },
  { id: 'role-membership',     label: 'Role Membership',           icon: Shield,        color: C.purple, description: 'Who is in each role — drill down by role or department.',                    endpoint: '/reports/role-membership' },
  { id: 'access-requests',     label: 'Access Request Log',        icon: Clock,         color: C.amber,  description: 'Full request history with SLA, approval rates, and resolution times.',       endpoint: '/reports/access-requests' },
  { id: 'sod-violations',      label: 'SoD Violations',            icon: AlertTriangle, color: C.red,    description: 'All Separation of Duties violations — open and resolved.',                   endpoint: '/reports/sod-violations' },
  { id: 'certification-status',label: 'Certification Campaigns',   icon: CheckCircle,   color: C.green,  description: 'Campaign-level stats: completion rate, revoke rate, open items.',            endpoint: '/reports/certification-status' },
  { id: 'certification-items', label: 'Certification Items Detail', icon: Table,         color: C.green,  description: 'Individual reviewer decisions — who certified or revoked what.',             endpoint: '/reports/certification-items' },
  { id: 'connector-health',    label: 'Connector Sync Health',     icon: Activity,      color: C.cyan,   description: 'Sync success rates, records processed, duration per connector.',             endpoint: '/reports/connector-health' },
  { id: 'audit-log',           label: 'Audit Log',                 icon: BarChart3,     color: C.slate,  description: 'Full action trail — who did what, when, from where.',                       endpoint: '/reports/audit-log' },
  { id: 'dormant-users',       label: 'Dormant Users',             icon: Users,         color: C.amber,  description: 'Active users with roles who haven\'t logged in for 90+ days.',              endpoint: '/reports/dormant-users' },
  { id: 'privileged-access',   label: 'Privileged Access',         icon: Shield,        color: C.red,    description: 'All admin/privileged role assignments with MFA status.',                    endpoint: '/reports/privileged-access' },
];

export default function ReportsPage() {
  const [tab, setTab] = useState('dashboard'); // dashboard | reports | tableau
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [activeReport, setActiveReport] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [tableSearch, setTableSearch] = useState('');
  const [copiedSQL, setCopiedSQL] = useState('');

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const r = await API.get(`/reports/executive-summary?days=${days}`);
      setSummary(r.data);
    } catch { toast.error('Failed to load summary'); }
    finally { setSummaryLoading(false); }
  }, [days]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const runReport = async (report) => {
    setActiveReport(report);
    setReportLoading(true);
    setReportData(null);
    setTableSearch('');
    try {
      const r = await API.get(`${report.endpoint}?days=${days}`);
      setReportData(r.data);
      setTab('reports');
    } catch { toast.error('Report failed'); }
    finally { setReportLoading(false); }
  };

  const exportCSV = async (report) => {
    try {
      const res = await API.get(`${report.endpoint}?format=csv&days=${days}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = `${report.id}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV downloaded');
    } catch { toast.error('Export failed'); }
  };

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopiedSQL(label);
    setTimeout(() => setCopiedSQL(''), 2000);
    toast.success('Copied!');
  };

  const tableauViews = [
    { name: 'vw_user_access_flat', description: 'One row per user-role assignment. Use as your primary dimension table.', color: C.cyan },
    { name: 'vw_access_requests_analytics', description: 'Requests with SLA buckets, date parts, resolution hours. Perfect for time series.', color: C.amber },
    { name: 'vw_certification_summary', description: 'Campaign-level stats: completion%, revoke rate, open items.', color: C.green },
    { name: 'vw_sod_violations', description: 'All violations with severity, policy, user, department, month.', color: C.red },
    { name: 'vw_connector_sync_history', description: 'Sync jobs with duration, records processed, success/fail status.', color: C.purple },
    { name: 'vw_dormant_users', description: 'Users with active roles who haven\'t logged in 90+ days.', color: C.amber },
  ];

  const tableauSQL = [
    { label: 'Access request approval rate by department', sql: `SELECT requester_department, COUNT(*) as total,\n  COUNT(*) FILTER (WHERE status='approved') as approved,\n  ROUND(COUNT(*) FILTER (WHERE status='approved')::numeric/NULLIF(COUNT(*),0)*100,1) as approval_rate\nFROM vw_access_requests_analytics\nGROUP BY requester_department ORDER BY total DESC` },
    { label: 'Monthly access requests trend', sql: `SELECT request_month, status, COUNT(*) as count\nFROM vw_access_requests_analytics\nWHERE request_month >= NOW() - INTERVAL '12 months'\nGROUP BY request_month, status ORDER BY request_month` },
    { label: 'Top 10 roles by user count', sql: `SELECT role_name, COUNT(DISTINCT username) as user_count\nFROM vw_user_access_flat\nWHERE assignment_status = 'active'\nGROUP BY role_name ORDER BY user_count DESC LIMIT 10` },
    { label: 'Users with no MFA and admin roles', sql: `SELECT username, email, department, role_name\nFROM vw_user_access_flat\nWHERE mfa_enabled = false\n  AND (role_type = 'admin' OR role_name ILIKE '%admin%')` },
    { label: 'Certification completion by campaign', sql: `SELECT campaign_name, total_items, certified, revoked, pending, completion_pct, revoke_rate_pct\nFROM vw_certification_summary\nORDER BY completion_pct DESC` },
    { label: 'SoD violations by department this month', sql: `SELECT u.department, COUNT(*) as violations\nFROM vw_sod_violations v JOIN users u ON u.username = v.username\nWHERE v.violation_date >= DATE_TRUNC('month', NOW())\nGROUP BY u.department ORDER BY violations DESC` },
  ];

  // Filter table data
  const rows = reportData?.data || (Array.isArray(reportData) ? reportData : []);
  const filteredRows = tableSearch ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(tableSearch.toLowerCase())) : rows;
  const cols = filteredRows[0] ? Object.keys(filteredRows[0]) : [];

  const s = summary;

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Reports & Analytics</div><div className="page-subtitle">IAM insights, compliance reports, and Tableau BI integration</div></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={days} onChange={e => setDays(parseInt(e.target.value))} style={{ padding: '7px 10px', background: 'var(--bg-tertiary)', border: '1px solid #334155', borderRadius: 6, color: 'var(--text-secondary)' }}>
            {[7,14,30,60,90,180,365].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button className="btn btn-secondary" onClick={fetchSummary}><RefreshCw size={13} /></button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #1e293b', paddingBottom: 0 }}>
        {[
          { id: 'dashboard', label: 'Executive Dashboard' },
          { id: 'reports', label: 'Run Reports' },
          { id: 'tableau', label: '📊 Tableau / BI Connect' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: tab === t.id ? 700 : 400, color: tab === t.id ? '#06b6d4' : 'var(--text-muted)', borderBottom: tab === t.id ? '2px solid #06b6d4' : '2px solid transparent', marginBottom: -1 }}>{t.label}</button>
        ))}
      </div>

      {/* ── EXECUTIVE DASHBOARD ───────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <div>
          {summaryLoading ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading dashboard…</div>
          ) : s ? (
            <div>
              {/* KPIs row 1 — Users */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                <KPI label="Total Users" value={s.users?.total_users} sub={`${s.users?.active_users} active`} color={C.cyan} icon={Users} />
                <KPI label="MFA Adoption" value={`${s.users?.mfa_adoption_pct || 0}%`} sub={`${s.users?.mfa_enabled_users} of ${s.users?.active_users} users`} color={s.users?.mfa_adoption_pct >= 80 ? C.green : C.amber} icon={Shield} />
                <KPI label="New Users" value={s.users?.new_users} sub={`last ${days} days`} color={C.cyan} icon={TrendingUp} />
                <KPI label="Privileged Assignments" value={s.risk_indicators?.privileged_assignments} sub="admin/super roles" color={C.red} icon={Shield} />
                <KPI label="Dormant w/ Access" value={s.risk_indicators?.dormant_users_with_access} sub="90+ days inactive, has roles" color={s.risk_indicators?.dormant_users_with_access > 0 ? C.amber : C.green} icon={Users} />
              </div>

              {/* KPIs row 2 — Requests */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                <KPI label="Access Requests" value={s.access_requests?.total} sub={`last ${days} days`} color={C.amber} icon={Clock} />
                <KPI label="Approval Rate" value={`${s.access_requests?.approval_rate_pct || 0}%`} sub={`${s.access_requests?.approved} approved`} color={parseFloat(s.access_requests?.approval_rate_pct) >= 70 ? C.green : C.amber} icon={CheckCircle} />
                <KPI label="Pending Approvals" value={s.access_requests?.pending} sub="awaiting action" color={s.access_requests?.pending > 10 ? C.red : C.amber} icon={Clock} />
                <KPI label="Avg Resolution" value={s.access_requests?.avg_resolution_hours ? `${s.access_requests.avg_resolution_hours}h` : '—'} sub="average hours to close" color={C.cyan} icon={Activity} />
                <KPI label="Open SoD Violations" value={s.policy_violations?.open_violations} sub={`${s.policy_violations?.critical_violations || 0} critical`} color={s.policy_violations?.open_violations > 0 ? C.red : C.green} icon={AlertTriangle} />
              </div>

              {/* KPIs row 3 — Connectors & Certs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
                <KPI label="Connectors" value={`${s.connectors?.connected || 0}/${s.connectors?.total_connectors || 0}`} sub={`${s.connectors?.errored || 0} errored`} color={s.connectors?.errored > 0 ? C.red : C.green} icon={Activity} />
                <KPI label="Active Certifications" value={s.certifications?.active_campaigns} sub={`${s.certifications?.completed_campaigns} completed`} color={C.green} icon={CheckCircle} />
              </div>

              {/* Risk Summary Panel */}
              <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>🛡️ Risk Indicators</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {[
                    { label: 'MFA Coverage', value: `${s.users?.mfa_adoption_pct || 0}%`, status: parseFloat(s.users?.mfa_adoption_pct) >= 80 ? 'good' : parseFloat(s.users?.mfa_adoption_pct) >= 50 ? 'warn' : 'bad', detail: 'Target: >80% of active users' },
                    { label: 'Open SoD Violations', value: s.policy_violations?.open_violations, status: s.policy_violations?.open_violations == 0 ? 'good' : s.policy_violations?.critical_violations > 0 ? 'bad' : 'warn', detail: `${s.policy_violations?.critical_violations || 0} critical, ${s.policy_violations?.high_violations || 0} high` },
                    { label: 'Dormant Access', value: s.risk_indicators?.dormant_users_with_access, status: s.risk_indicators?.dormant_users_with_access == 0 ? 'good' : s.risk_indicators?.dormant_users_with_access > 10 ? 'bad' : 'warn', detail: 'Users 90+ days inactive with active roles' },
                    { label: 'Pending Approvals', value: s.access_requests?.pending, status: s.access_requests?.pending == 0 ? 'good' : s.access_requests?.pending > 20 ? 'bad' : 'warn', detail: `Avg resolution: ${s.access_requests?.avg_resolution_hours || '?'}h` },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 8, background: 'var(--bg-primary)', border: `1px solid ${item.status === 'good' ? '#10b98120' : item.status === 'bad' ? '#ef444420' : '#f59e0b20'}` }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.status === 'good' ? C.green : item.status === 'bad' ? C.red : C.amber, flexShrink: 0 }} />
                      <div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>{item.label}</div>
                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{item.value ?? '—'}</div>
                        <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{item.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick run buttons */}
              <div style={{ padding: '14px 16px', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid #1e293b', color: 'var(--text-muted)' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Quick Reports: </span>
                {REPORTS.slice(0, 5).map(r => (
                  <button key={r.id} onClick={() => runReport(r)} style={{ background: 'none', border: '1px solid #1e293b', borderRadius: 4, cursor: 'pointer', color: r.color, padding: '3px 10px', marginLeft: 6, marginBottom: 4 }}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── RUN REPORTS ───────────────────────────────────────────────────── */}
      {tab === 'reports' && (
        <div>
          {/* Report catalog */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
            {REPORTS.map(r => (
              <div key={r.id} className="card" style={{ border: `1px solid ${activeReport?.id === r.id ? r.color : 'var(--bg-tertiary)'}`, cursor: 'pointer', padding: 16 }}
                onClick={() => runReport(r)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${r.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <r.icon size={16} color={r.color} />
                    </div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</div>
                  </div>
                  {activeReport?.id === r.id && reportLoading && <RefreshCw size={13} color={r.color} style={{ animation: 'spin 1s linear infinite' }} />}
                </div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>{r.description}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); runReport(r); }} disabled={reportLoading && activeReport?.id === r.id}>Run</button>
                  <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); exportCSV(r); }}><Download size={11} /> CSV</button>
                </div>
              </div>
            ))}
          </div>

          {/* Results table */}
          {reportLoading && <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Running report…</div>}
          {reportData && !reportLoading && (
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{activeReport?.label}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 12 }}>{filteredRows.length} rows {tableSearch && `(filtered from ${rows.length})`}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="Filter results…" value={tableSearch} onChange={e => setTableSearch(e.target.value)}
                    style={{ padding: '6px 10px', background: 'var(--bg-primary)', border: '1px solid #1e293b', borderRadius: 6, color: 'var(--text-secondary)', width: 200 }} />
                  <button className="btn btn-secondary btn-sm" onClick={() => exportCSV(activeReport)}><Download size={11} /> Export CSV</button>
                </div>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
                <table>
                  <thead style={{ position: 'sticky', top: 0 }}>
                    <tr>{cols.map(c => <th key={c} style={{ whiteSpace: 'nowrap' }}>{c.replace(/_/g, ' ').toUpperCase()}</th>)}</tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 500).map((row, i) => (
                      <tr key={i}>
                        {cols.map(c => (
                          <td key={c} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row[c] === null || row[c] === undefined ? <span style={{ color: 'var(--text-secondary)' }}>—</span>
                              : typeof row[c] === 'boolean' ? <span style={{ color: row[c] ? C.green : C.red }}>{row[c] ? '✓' : '✗'}</span>
                              : String(row[c]).length > 60 ? <span title={String(row[c])}>{String(row[c]).slice(0, 58)}…</span>
                              : String(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredRows.length > 500 && <div style={{ padding: '10px 20px', color: 'var(--text-muted)', borderTop: '1px solid #1e293b' }}>Showing 500 of {filteredRows.length} rows. Export CSV for full data.</div>}
            </div>
          )}
        </div>
      )}

      {/* ── TABLEAU / BI CONNECT ──────────────────────────────────────────── */}
      {tab === 'tableau' && (
        <div>
          {/* Connection card */}
          <div className="card" style={{ marginBottom: 20, border: '1px solid rgba(6,182,212,0.2)' }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={16} color={C.cyan} /> Tableau Direct Connection
            </div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
              Connect Tableau Desktop or Tableau Server directly to the NexusIAM PostgreSQL database using the read-only <code style={{ color: C.cyan, background: 'var(--bg-primary)', padding: '1px 6px', borderRadius: 4 }}>nexusiam_bi</code> user.
              Six pre-built views are ready for drag-and-drop analysis — no SQL required.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {[
                { label: 'Connector Type', value: 'PostgreSQL' },
                { label: 'Server / Host', value: 'localhost (or your Docker host)' },
                { label: 'Port', value: '5432' },
                { label: 'Database', value: 'nexusiam' },
                { label: 'Username', value: 'nexusiam_bi' },
                { label: 'Password', value: 'NexusBIRead@2024! (change this)' },
                { label: 'SSL', value: 'Optional (off for local)' },
                { label: 'Schema', value: 'public' },
              ].map(row => (
                <div key={row.label} style={{ padding: '10px 14px', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid #1e293b' }}>
                  <div style={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{row.label}</div>
                  <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{row.value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: 'var(--text-secondary)' }}>
              ⚠️ <strong style={{ color: '#ef4444' }}>Before going to production:</strong> change the <code style={{ color: '#f59e0b' }}>nexusiam_bi</code> password in <code style={{ color: '#f59e0b' }}>init.sql</code>, restrict PostgreSQL to your network, and never expose port 5432 publicly.
            </div>
          </div>

          {/* Pre-built views */}
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Pre-Built Tableau Views</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginBottom: 28 }}>
            {tableauViews.map(v => (
              <div key={v.name} className="card" style={{ padding: 16, border: `1px solid ${v.color}20` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="mono" style={{ color: v.color, fontWeight: 700 }}>{v.name}</span>
                  <button onClick={() => copyText(v.name, v.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    {copiedSQL === v.name ? <CheckCircle size={12} color={C.green} /> : <Copy size={12} />}
                  </button>
                </div>
                <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{v.description}</div>
              </div>
            ))}
          </div>

          {/* Sample SQL queries */}
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Sample Custom SQL for Tableau</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tableauSQL.map(q => (
              <div key={q.label} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{q.label}</span>
                  <button onClick={() => copyText(q.sql, q.label)} className="btn btn-secondary btn-sm">
                    {copiedSQL === q.label ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy SQL</>}
                  </button>
                </div>
                <pre style={{ margin: 0, padding: '12px 16px', color: '#06b6d4', background: 'var(--bg-primary)', overflowX: 'auto', lineHeight: 1.6 }}>{q.sql}</pre>
              </div>
            ))}
          </div>

          {/* Recommended Tableau Dashboard Layout */}
          <div className="card" style={{ marginTop: 24, border: '1px solid rgba(139,92,246,0.2)' }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={15} color={C.purple} /> Recommended Tableau Dashboard Structure
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {[
                { title: 'Sheet 1: Access Overview', desc: 'Bar chart — users by department. Color by role count. Source: vw_user_access_flat', color: C.cyan },
                { title: 'Sheet 2: Request Trends', desc: 'Line chart — requests by month, colored by status. Source: vw_access_requests_analytics', color: C.amber },
                { title: 'Sheet 3: SLA Compliance', desc: 'Stacked bar — resolution time buckets by department. Source: vw_access_requests_analytics', color: C.green },
                { title: 'Sheet 4: SoD Risk Heatmap', desc: 'Highlight table — violations by department x severity. Source: vw_sod_violations', color: C.red },
                { title: 'Sheet 5: Cert Completion', desc: 'Bar chart — certification campaigns with completion%. Source: vw_certification_summary', color: C.green },
                { title: 'Dashboard: Executive View', desc: 'Combine all 5 sheets. Add KPI tiles for MFA%, violations, dormant users as text marks.', color: C.purple },
              ].map(item => (
                <div key={item.title} style={{ padding: '12px 14px', background: 'var(--bg-primary)', borderRadius: 8, borderLeft: `3px solid ${item.color}` }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{item.title}</div>
                  <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
