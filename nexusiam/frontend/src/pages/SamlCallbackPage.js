/**
 * SAML Callback Handler
 * Route: /saml/callback
 *
 * After the IdP redirects back, tokens arrive in the URL fragment:
 *   /saml/callback#access=<token>&refresh=<token>
 *
 * This page extracts them, stores in localStorage, and redirects to dashboard.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function SamlCallbackPage() {
  const navigate  = useNavigate();
  const [status, setStatus] = useState('Processing SAML response…');
  const [error,  setError]  = useState(null);

  useEffect(() => {
    try {
      const hash   = window.location.hash.slice(1); // remove leading #
      const params = new URLSearchParams(hash);
      const access  = params.get('access');
      const refresh = params.get('refresh');

      if (!access || !refresh) {
        setError('No tokens in SAML callback. Authentication may have failed.');
        setTimeout(() => navigate('/login?error=SAML+callback+missing+tokens'), 3000);
        return;
      }

      localStorage.setItem('accessToken',  decodeURIComponent(access));
      localStorage.setItem('refreshToken', decodeURIComponent(refresh));

      setStatus('Authentication successful — redirecting…');
      // Clear the fragment from URL immediately
      window.history.replaceState(null, '', window.location.pathname);
      setTimeout(() => navigate('/dashboard'), 500);
    } catch (e) {
      setError('Failed to process SAML response: ' + e.message);
      setTimeout(() => navigate('/login'), 3000);
    }
  }, [navigate]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-primary)' }}>
        {error ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠</div>
            <div style={{ color: '#ef4444', marginBottom: 8 }}>SAML Error</div>
            <div style={{ color: 'var(--text-muted)' }}>{error}</div>
            <div style={{ color: 'var(--text-secondary)', marginTop: 8 }}>Redirecting to login…</div>
          </>
        ) : (
          <>
            <div style={{ width: 40, height: 40, border: '3px solid #38bdf8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ color: 'var(--text-secondary)' }}>{status}</div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
