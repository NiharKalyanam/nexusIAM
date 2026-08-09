import React, { createContext, useContext, useState, useEffect } from 'react';
import API from '../utils/api';

const AuthContext = createContext(null);

function applyTheme(t) {
  document.body.classList.toggle('theme-light', t === 'light');
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState(
    () => localStorage.getItem('nexusiam_theme') || 'dark'
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      API.get('/auth/me')
        .then(({ data }) => setUser(data))
        .catch(() => {
          const savedTheme = localStorage.getItem('nexusiam_theme');
          localStorage.clear();
          if (savedTheme) localStorage.setItem('nexusiam_theme', savedTheme);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []); // eslint-disable-line

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('nexusiam_theme', next);
    setThemeState(next);
    // Only save to backend when logged in
    if (localStorage.getItem('accessToken')) {
      try { API.put('/users/me/theme', { theme: next }); } catch {}
    }
  };

  const login = async (username, password, tenantSlug) => {
    const { data } = await API.post('/auth/login', { username, password, tenantSlug });
    if (data.mfaRequired) return data;
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setUser(data.user);
    return data;
  };

  const verifyMFA = async (mfaToken, code) => {
    const { data } = await API.post('/auth/mfa/verify', { mfaToken, code });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    try { await API.post('/auth/logout'); } catch {}
    const savedTheme = localStorage.getItem('nexusiam_theme') || theme;
    localStorage.clear();
    localStorage.setItem('nexusiam_theme', savedTheme);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, verifyMFA, setUser, theme, toggleTheme }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);