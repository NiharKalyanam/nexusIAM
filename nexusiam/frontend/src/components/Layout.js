import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, Users, Shield, AppWindow, ClipboardList, CheckSquare, CheckCircle,
  AlertTriangle, ScrollText, GitBranch, Plug, Package, FileText, BarChart3,
  LogOut, Bell, ChevronLeft, ChevronRight, Zap, Workflow, X, TerminalSquare,
  Layers, PersonStanding, ShieldCheck, ArrowLeftRight, KeyRound, Sun, Moon
} from 'lucide-react';
import API from '../utils/api';

const navGroups = [
  { label: 'Overview', items: [{ to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' }] },
  {
    label: 'Identity', items: [
      { to: '/users',        icon: Users,         label: 'Users',            capability: 'users.manage' },
      { to: '/workgroups',   icon: Users,         label: 'Workgroups',       capability: 'users.manage' },
      { to: '/roles',        icon: Shield,        label: 'Roles' },
      { to: '/applications', icon: AppWindow,     label: 'Applications',     capability: 'applications.manage' },
      { to: '/entitlements', icon: KeyRound,      label: 'Entitlements',     capability: 'applications.manage' },
    ]
  },
  {
    label: 'Governance', items: [
      { to: '/access-requests', icon: ClipboardList, label: 'Access Requests', capability: 'approvals.work' },
      { to: '/certifications',  icon: CheckSquare,   label: 'Certifications' },
      { to: '/approvals',         icon: CheckCircle,   label: 'Approvals' },
      { to: '/policies',        icon: AlertTriangle, label: 'Policies & SoD' },
      { to: '/cab',             icon: GitBranch,     label: 'CAB Cases' },
    ]
  },
  {
    label: 'Operations', items: [
      { to: '/connectors',       icon: Plug,          label: 'Connectors',        capability: 'connectors.manage' },
      { to: '/aggregations',     icon: Layers,        label: 'Aggregation Studio', capability: 'aggregations.run' },
      { to: '/provisioning',     icon: ArrowLeftRight,label: 'Provisioning Center',capability: 'connectors.manage' },
      { to: '/lifecycle',        icon: PersonStanding,label: 'Lifecycle Events',   capability: 'lifecycle.manage' },
      { to: '/plugins',          icon: Package,       label: 'Plugins & Loggers' },
      { to: '/studio',           icon: Workflow,      label: 'Platform Studio' },
      { to: '/developer-console',icon: TerminalSquare,label: 'Developer Console',  capability: 'developer.console' },
      { to: '/capabilities',     icon: ShieldCheck,   label: 'Capabilities',       capability: 'admin.capabilities' },
      { to: '/logs',             icon: FileText,      label: 'Logs' },
      { to: '/audit',            icon: ScrollText,    label: 'Audit Trail' },
      { to: '/reports',          icon: BarChart3,     label: 'Reports' },
      { to: '/settings',         icon: ShieldCheck,   label: 'Global Settings' },
    ]
  }
];

// Avatar always uses its own colors — not affected by theme since it's in sidebar
function UserAvatar({ user, size = 32 }) {
  const initials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`;
  if (user?.photo_url) {
    return (
      <img
        src={user.photo_url}
        alt={initials}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid #334155', flexShrink: 0 }}
        onError={e => { e.target.style.display = 'none'; }}
      />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.floor(size * 0.35), fontWeight: 700, color: '#fff', flexShrink: 0, letterSpacing: '-0.02em' }}>
      {initials}
    </div>
  );
}

export default function Layout() {
  const { user, logout, theme, toggleTheme } = useAuth();
  const navigate  = useNavigate();
  const [collapsed, setCollapsed]   = useState(false);
  const [notifOpen, setNotifOpen]   = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount]     = useState(0);

  const hasCapability = (cap) =>
    !cap ||
    user?.capabilities?.includes('*') ||
    user?.capabilities?.includes(cap) ||
    user?.roles?.includes('Super Admin');

  useEffect(() => {
    const fetchCount = () => API.get('/notifications/summary').then(r => setUnreadCount(r.data?.unread || 0)).catch(() => {});
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchNotifs = async () => {
    try {
      const [nr, sr] = await Promise.all([
        API.get('/notifications?limit=20'),
        API.get('/notifications/summary'),
      ]);
      setNotifications(nr.data?.data || []);
      setUnreadCount(sr.data?.unread || 0);
    } catch {}
  };

  const markRead = async (id) => {
    try { await API.put(`/notifications/${id}/read`); setUnreadCount(p => Math.max(0, p - 1)); } catch {}
  };

  const markAllRead = async () => {
    try {
      await API.put('/notifications/read-all');
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  };

  const handleLogout = async () => { await logout(); navigate('/login'); };

  // Sidebar always dark regardless of theme — better contrast
  const sb = { bg: 'var(--bg-secondary)', border: 'var(--bg-tertiary)', text: 'var(--text-secondary)', label: 'var(--text-secondary)' };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── Sidebar (always dark) ── */}
      <div style={{ width: collapsed ? 56 : 220, background: sb.bg, borderRight: `1px solid ${sb.border}`, display: 'flex', flexDirection: 'column', transition: 'width 0.2s', flexShrink: 0 }}>

        {/* Logo - clickable to dashboard */}
        <div
          onClick={() => navigate('/dashboard')}
          style={{ padding: collapsed ? '16px 0' : '16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${sb.border}`, minHeight: 56, justifyContent: collapsed ? 'center' : 'flex-start', cursor: 'pointer' }}
          title="Go to Dashboard"
        >
          <div style={{ width: 30, height: 30, background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Zap size={16} color="#fff" />
          </div>
          {!collapsed && (
            <div>
              <div style={{ fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>NexusIAM</div>
              <div style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Identity Platform</div>
            </div>
          )}
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 8px' }}>
          {navGroups.map(group => (
            <div key={group.label} style={{ marginBottom: 6 }}>
              {!collapsed && (
                <div style={{ fontWeight: 700, color: sb.label, textTransform: 'uppercase', letterSpacing: '0.12em', padding: '5px 8px 3px' }}>
                  {group.label}
                </div>
              )}
              {group.items.filter(item => hasCapability(item.capability)).map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : ''}
                  style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center',
                    gap: 9, padding: collapsed ? '8px 0' : '8px 10px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    borderRadius: 7,
                    color: isActive ? '#06b6d4' : sb.text,
                    background: isActive ? 'rgba(6,182,212,0.12)' : 'transparent',
                    textDecoration: 'none', fontWeight: 500,
                    marginBottom: 1, transition: 'all 0.12s',
                    whiteSpace: 'nowrap', overflow: 'hidden'})}
                >
                  <item.icon size={15} style={{ flexShrink: 0 }} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom: user + logout */}
        <div style={{ borderTop: `1px solid ${sb.border}`, padding: '10px 8px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: collapsed ? '8px 0' : '8px 10px', justifyContent: collapsed ? 'center' : 'flex-start', borderRadius: 7, cursor: 'pointer', marginBottom: 2 }}
            onClick={() => navigate('/profile')}
            title={collapsed ? `${user?.first_name} ${user?.last_name}` : ''}
          >
            <UserAvatar user={user} size={28} />
            {!collapsed && (
              <div style={{ overflow: 'hidden', flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.first_name} {user?.last_name}
                </div>
                <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.email}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            title="Logout"
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: collapsed ? '8px 0' : '8px 10px', justifyContent: collapsed ? 'center' : 'flex-start', background: 'none', border: 'none', borderRadius: 7, color: sb.text, cursor: 'pointer', fontWeight: 500, transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
            onMouseLeave={e => e.currentTarget.style.color = sb.text}
          >
            <LogOut size={15} style={{ flexShrink: 0 }} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>

        {/* Topbar */}
        <div style={{ height: 52, background: 'var(--topbar-bg)', borderBottom: '1px solid var(--topbar-border)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4, borderRadius: 6, display: 'flex' }}
          >
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>

          <div style={{ flex: 1 }} />

          {/* Theme toggle — next to bell */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{ background: 'none', border: '1px solid var(--border-bright)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer', padding: '5px 7px', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-bright)'; }}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* Bell */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen) fetchNotifs(); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 6, borderRadius: 7, display: 'flex', position: 'relative' }}
            >
              <Bell size={17} />
              {unreadCount > 0 && (
                <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, background: '#ef4444', borderRadius: '50%', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', lineHeight: 1 }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div style={{ position: 'absolute', right: 0, top: '110%', width: 320, background: 'var(--modal-bg)', border: '1px solid var(--border-bright)', borderRadius: 12, boxShadow: 'var(--shadow)', zIndex: 100, maxHeight: 380, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Notifications</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                        Mark all read
                      </button>
                    )}
                    <button onClick={() => setNotifOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={13} /></button>
                  </div>
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {notifications.length === 0
                    ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No notifications</div>
                    : notifications.map(n => (
                        <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: n.read ? 'transparent' : 'rgba(6,182,212,0.04)' }}
                          onClick={() => { markRead(n.id); setNotifOpen(false); if (n.link) navigate(n.link); }}>
                          <div style={{ color: 'var(--text-primary)', marginBottom: 3 }}>{n.title}</div>
                          <div style={{ color: 'var(--text-muted)' }}>{n.message}</div>
                        </div>
                      ))
                  }
                </div>
              </div>
            )}
          </div>

          {/* User chip */}
          <button
            onClick={() => navigate('/profile')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 7 }}
          >
            <UserAvatar user={user} size={26} />
            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{user?.first_name} {user?.last_name}</span>
          </button>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          <Outlet />
        </div>

        {/* Footer */}
        <div className="app-footer">
          © 2026 NexusIAM Platform · Enterprise Identity & Access Management · All rights reserved
        </div>
      </div>
    </div>
  );
}
