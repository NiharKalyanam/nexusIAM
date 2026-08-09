import axios from 'axios';

const API = axios.create({
  baseURL: '/api/v1',
  timeout: 30000});

// Request interceptor - attach token
API.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    config.headers['X-Correlation-ID'] = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return config;
  },
  (err) => Promise.reject(err)
);

// Helper - clear auth but keep theme
function clearAuth() {
  const theme = localStorage.getItem('nexusiam_theme');
  localStorage.clear();
  if (theme) localStorage.setItem('nexusiam_theme', theme);
}

// Response interceptor - handle 401 including session timeout codes
API.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const errCode = err.response?.data?.code;
    const is401 = err.response?.status === 401;

    // Session timeout codes — don't attempt refresh, go straight to login with message
    if (is401 && (errCode === 'SESSION_IDLE_TIMEOUT' || errCode === 'SESSION_MAX_LIFETIME' || errCode === 'REFRESH_EXPIRED')) {
      clearAuth();
      const msg = errCode === 'SESSION_IDLE_TIMEOUT'
        ? 'Your session expired due to inactivity.'
        : 'Your session has reached its maximum lifetime.';
      window.location.href = `/login?reason=${encodeURIComponent(msg)}`;
      return Promise.reject(err);
    }

    if (is401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) { clearAuth(); window.location.href = '/login'; return Promise.reject(err); }
        const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return API(original);
      } catch {
        clearAuth();
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default API;