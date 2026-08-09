import React from 'react';
import { useNavigate } from 'react-router-dom';

const SETTINGS_CARDS = [
  {
    key: 'identity-mapping',
    title: 'Identity Mapping',
    description: 'Define identity attributes and configure source/target mappings from authoritative applications.',
    icon: '🗂️',
    color: '#3b82f6',
    path: '/settings/identity-mapping',
  },
  {
    key: 'security',
    title: 'Security',
    description: 'SSO/SAML configuration, session timeouts, email transport, API keys, and credential vault.',
    icon: '🔐',
    status: 'active',
    path: '/settings/security',
  },
  {
    key: 'attribute-sync',
    title: 'Attribute Sync',
    description: 'Configure and run attribute synchronization jobs to keep identities in sync with source systems.',
    icon: '🔄',
    color: '#10b981',
    path: '/settings/attribute-sync',
    badge: 'Coming Soon',
  },

  {
    key: 'notification-templates',
    title: 'Notification Templates',
    description: 'View branded email templates sent by NexusIAM for workgroup, provisioning, and lifecycle events.',
    icon: '✉️',
    color: '#f59e0b',
    path: '/settings/notifications',
    badge: 'Coming Soon',
  },
  {
    key: 'audit-config',
    title: 'Audit Configuration',
    description: 'Configure audit log retention and system operation auditing settings.',
    icon: '📋',
    color: '#06b6d4',
    path: '/settings/audit',
    badge: 'Coming Soon',
  },
  {
    key: 'access-request-setup',
    title: 'Access Request Setup',
    description: 'Configure approval workflows, manager approval, entitlement owner approval, notifications, reminders, and escalation rules.',
    icon: '📝',
    color: '#8b5cf6',
    path: '/settings/access-request-setup',
  },
  {
    key: 'global-config',
    title: 'Global Configuration',
    description: 'Configure system-wide settings including lifecycle event triggers and identity refresh options.',
    icon: '⚙️',
    color: 'var(--text-muted)',
    path: '/settings/global-config',
    badge: 'Coming Soon',
  },
];

export default function GlobalSettingsPage() {
  const navigate = useNavigate();

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Global Settings</div>
          <div className="page-subtitle">Configure system-wide settings for your NexusIAM tenant</div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 16,
        marginTop: 8 }}>
        {SETTINGS_CARDS.map(card => (
          <div
            key={card.key}
            onClick={() => !card.badge && navigate(card.path)}
            style={{
              background: 'var(--bg-tertiary)',
              border: `1px solid #1e2a3a`,
              borderRadius: 12,
              padding: 24,
              cursor: card.badge ? 'default' : 'pointer',
              transition: 'border-color 0.15s, transform 0.15s',
              opacity: card.badge ? 0.6 : 1,
              position: 'relative',
              overflow: 'hidden' }}
            onMouseEnter={e => {
              if (!card.badge) {
                e.currentTarget.style.borderColor = card.color;
                e.currentTarget.style.transform = 'translateY(-2px)';
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--bg-tertiary)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {/* color accent bar */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 3,
              background: card.color, opacity: 0.7 }} />

            {card.badge && (
              <span style={{
                position: 'absolute', top: 12, right: 12,
                background: 'rgba(100,116,139,0.2)', color: 'var(--text-muted)', fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                textTransform: 'uppercase', letterSpacing: 0.5 }}>{card.badge}</span>
            )}

            <div style={{ fontSize: 32, marginBottom: 12 }}>{card.icon}</div>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{card.title}</div>
            <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{card.description}</div>

            {!card.badge && (
              <div style={{ marginTop: 16, color: card.color, fontWeight: 600 }}>
                Configure →
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
