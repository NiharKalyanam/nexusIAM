import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { Zap, Eye, EyeOff, Shield, Sun, Moon } from 'lucide-react';

export default function LoginPage() {
  const { login, verifyMFA, theme, toggleTheme } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sessionReason = new URLSearchParams(location.search).get('reason');
  const ssoError      = new URLSearchParams(location.search).get('ssoError');
  const [form, setForm]     = useState({ username: 'admin', password: 'Admin@2024!', tenantSlug: 'demo' });
  const [mfa, setMfa]       = useState({ required: false, token: '', code: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await login(form.username, form.password, form.tenantSlug);
      if (res.mfaRequired) {
        setMfa({ required: true, token: res.mfaToken, code: '' });
        toast.success('MFA code required');
      } else {
        toast.success('Welcome back!');
        navigate('/dashboard');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  const handleMFA = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await verifyMFA(mfa.token, mfa.code);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch {
      toast.error('Invalid MFA code');
    } finally { setLoading(false); }
  };

  const isLight = theme === 'light';

  return (
    <div style={{
      minHeight: '100vh',
      background: isLight
        ? 'linear-gradient(135deg, #f4f6f9 0%, #eaeef4 50%, #f4f6f9 100%)'
        : 'linear-gradient(135deg, #0a0f1a 0%, #0d1525 50%, #0a0f1a 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24, position: 'relative',
      transition: 'background 0.2s'
    }}>
      {/* Background grid - dark only */}
      {!isLight && (
        <div style={{ position: 'fixed', inset: 0, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(6,182,212,0.08) 1px, transparent 0)', backgroundSize: '40px 40px', pointerEvents: 'none' }} />
      )}

      {/* Theme toggle - top right */}
      <button
        onClick={toggleTheme}
        title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
        style={{
          position: 'fixed', top: 20, right: 20,
          width: 40, height: 40, borderRadius: 10,
          border: `1px solid ${isLight ? '#c8d0dc' : '#334155'}`,
          background: isLight ? '#ffffff' : '#111827',
          color: isLight ? '#374151' : '#94a3b8',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', transition: 'all 0.2s'
        }}
      >
        {isLight ? <Moon size={18} /> : <Sun size={18} />}
      </button>

      <div style={{ width: '100%', maxWidth: 420, position: 'relative' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ width: 60, height: 60, background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)', borderRadius: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', boxShadow: '0 0 40px rgba(6,182,212,0.3)' }}>
            <Zap size={30} color="#fff" />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: isLight ? '#111827' : '#f1f5f9', letterSpacing: '-0.02em' }}>NexusIAM</h1>
          <p style={{ color: isLight ? '#6b7280' : '#64748b', marginTop: 6 }}>Enterprise Identity & Access Management</p>
        </div>

        {/* Card */}
        <div style={{
          background: isLight ? '#ffffff' : '#111827',
          border: `1px solid ${isLight ? '#dde3ed' : '#1e293b'}`,
          borderRadius: 20, padding: 32,
          boxShadow: isLight ? '0 8px 32px rgba(0,0,0,0.1)' : '0 25px 50px rgba(0,0,0,0.5)',
          transition: 'background 0.2s, border-color 0.2s'
        }}>
          {!mfa.required ? (
            <>
              <h2 style={{ fontWeight: 600, color: isLight ? '#111827' : '#f1f5f9', marginBottom: 6 }}>Sign in</h2>
              <p style={{ color: isLight ? '#6b7280' : '#64748b', marginBottom: 24 }}>Enter your credentials to continue</p>

              <form onSubmit={handleLogin}>
                {sessionReason && (
                  <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>⏱</span> {sessionReason}
                  </div>
                )}

                <div className="form-group">
                  <label style={{ color: isLight ? '#374151' : '#94a3b8' }}>Tenant</label>
                  <input
                    value={form.tenantSlug}
                    onChange={e => setForm({...form, tenantSlug: e.target.value})}
                    placeholder="demo"
                    style={{ background: isLight ? '#f8fafc' : '#1e293b', color: isLight ? '#111827' : '#f1f5f9', borderColor: isLight ? '#c8d0dc' : '#334155' }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ color: isLight ? '#374151' : '#94a3b8' }}>Username or Email</label>
                  <input
                    value={form.username}
                    onChange={e => setForm({...form, username: e.target.value})}
                    placeholder="admin"
                    required
                    style={{ background: isLight ? '#f8fafc' : '#1e293b', color: isLight ? '#111827' : '#f1f5f9', borderColor: isLight ? '#c8d0dc' : '#334155' }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ color: isLight ? '#374151' : '#94a3b8' }}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => setForm({...form, password: e.target.value})}
                      placeholder="••••••••••••"
                      required
                      style={{ paddingRight: 40, background: isLight ? '#f8fafc' : '#1e293b', color: isLight ? '#111827' : '#f1f5f9', borderColor: isLight ? '#c8d0dc' : '#334155' }}
                    />
                    <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: isLight ? '#6b7280' : '#64748b', cursor: 'pointer' }}>
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', marginTop: 6 }} disabled={loading}>
                  {loading ? <><div className="loading-spinner" style={{ width: 15, height: 15 }} /> Signing in...</> : 'Sign In'}
                </button>
              </form>

              <div style={{ marginTop: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ flex: 1, height: 1, background: isLight ? '#e5e7eb' : '#1e2a3a' }} />
                  <span style={{ color: isLight ? '#9ca3af' : '#4b5563' }}>or</span>
                  <div style={{ flex: 1, height: 1, background: isLight ? '#e5e7eb' : '#1e2a3a' }} />
                </div>
                <a
                  href={`/api/v1/auth/saml/login?tenant=${form.tenantSlug || 'demo'}`}
                  style={{
                    display: 'block', padding: '10px 0',
                    background: isLight ? '#f8fafc' : '#0d1525',
                    border: `1px solid ${isLight ? '#dde3ed' : '#1e2a3a'}`,
                    borderRadius: 8,
                    color: isLight ? '#374151' : '#94a3b8', textDecoration: 'none', textAlign: 'center',
                    transition: 'all 0.15s'
                  }}
                >
                  🔐 Sign in with SSO / SAML
                </a>
                {ssoError && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, color: '#fca5a5', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ flexShrink: 0 }}>⛔</span>
                    <span>{decodeURIComponent(ssoError)}</span>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, padding: '10px 12px', background: 'rgba(6,182,212,0.05)', borderRadius: 8, border: '1px solid rgba(6,182,212,0.15)' }}>
                <p style={{ color: isLight ? '#6b7280' : '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Shield size={12} color="#06b6d4" />
                  Demo: admin / Admin@2024! / tenant: demo
                </p>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ fontWeight: 600, color: isLight ? '#111827' : '#f1f5f9', marginBottom: 6 }}>Two-Factor Auth</h2>
              <p style={{ color: isLight ? '#6b7280' : '#64748b', marginBottom: 24 }}>Enter the 6-digit code from your authenticator app</p>
              <form onSubmit={handleMFA}>
                <div className="form-group">
                  <label style={{ color: isLight ? '#374151' : '#94a3b8' }}>MFA Code</label>
                  <input
                    value={mfa.code}
                    onChange={e => setMfa({...mfa, code: e.target.value})}
                    placeholder="000000" maxLength={6}
                    className="mono"
                    style={{ letterSpacing: '0.2em', textAlign: 'center', background: isLight ? '#f8fafc' : '#1e293b', color: isLight ? '#111827' : '#f1f5f9', borderColor: isLight ? '#c8d0dc' : '#334155' }}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '11px 16px' }} disabled={loading}>
                  {loading ? 'Verifying...' : 'Verify'}
                </button>
                <button type="button" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => setMfa({ required: false, token: '', code: '' })}>
                  Back to Login
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, color: isLight ? '#9ca3af' : '#334155' }}>
          © 2026 NexusIAM Platform · All rights reserved
        </p>
      </div>
    </div>
  );
}