import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, Key, Smartphone, Camera, Sun, Moon } from 'lucide-react';
import API from '../utils/api';
import toast from 'react-hot-toast';

function UserAvatar({ user, size = 72 }) {
  const [imgErr, setImgErr] = useState(false);
  const initials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`;
  if (user?.photo_url && !imgErr) {
    return (
      <img
        src={user.photo_url}
        alt={initials}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent)' }}
        onError={() => setImgErr(true)}
      />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.floor(size * 0.33), fontWeight: 700, color: '#fff', border: '3px solid #06b6d4' }}>
      {initials}
    </div>
  );
}

export default function ProfilePage() {
  const { user, setUser, theme, toggleTheme } = useAuth();
  const [pwForm, setPwForm]     = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [mfaSetup, setMfaSetup] = useState(null);
  const [mfaCode, setMfaCode]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const fileRef = useRef();

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirm) return toast.error('Passwords do not match');
    if (pwForm.newPassword.length < 12) return toast.error('Password must be at least 12 characters');
    setLoading(true);
    try {
      await API.post('/auth/change-password', { currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      toast.success('Password changed successfully');
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to change password'); }
    finally { setLoading(false); }
  };

  const handleSetupMFA = async () => {
    try { const r = await API.post('/auth/mfa/setup'); setMfaSetup(r.data); }
    catch { toast.error('Failed to setup MFA'); }
  };

  const handleEnableMFA = async () => {
    try {
      await API.post('/auth/mfa/enable', { code: mfaCode });
      toast.success('MFA enabled!');
      setMfaSetup(null); setMfaCode('');
    } catch { toast.error('Invalid code'); }
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error('Photo must be under 2MB');
    if (!file.type.startsWith('image/')) return toast.error('Only image files allowed');
    setPhotoLoading(true);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const { data } = await API.post('/users/me/photo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      // Force image reload by appending cache-bust as proper query param
      const base = data.photo_url.split('?')[0];
      const busted = `${base}?v=${Date.now()}`;
      setUser(prev => ({ ...prev, photo_url: busted }));
      toast.success('Photo updated!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to upload photo');
    } finally {
      setPhotoLoading(false);
      e.target.value = '';
    }
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-header">
        <div>
          <div className="page-title">Profile</div>
          <div className="page-subtitle">Manage your account settings</div>
        </div>
      </div>

      {/* Profile card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <UserAvatar user={user} size={76} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={photoLoading}
              title="Change photo"
              style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: '50%', background: '#06b6d4', border: '2px solid var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              {photoLoading
                ? <div className="loading-spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
                : <Camera size={12} color="#fff" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{user?.first_name} {user?.last_name}</div>
            <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{user?.email}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span className="badge badge-info">{user?.username}</span>
              <span className={`badge badge-${user?.mfa_enabled ? 'success' : 'warning'}`}>{user?.mfa_enabled ? 'MFA Enabled' : 'MFA Disabled'}</span>
              <span className={`badge badge-${user?.status === 'active' ? 'success' : 'danger'}`}>{user?.status}</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Click the camera icon to upload a photo (max 2MB · JPG, PNG, GIF, WEBP)
        </div>
      </div>

      {/* Appearance */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {theme === 'dark'
              ? <Moon size={18} color="#8b5cf6" />
              : <Sun size={18} color="#f59e0b" />}
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Appearance</div>
              <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                {theme === 'dark' ? 'Dark' : 'Light'} mode · saved to your account
              </div>
            </div>
          </div>
          <button onClick={toggleTheme} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {theme === 'dark' ? <><Sun size={14} /> Light Mode</> : <><Moon size={14} /> Dark Mode</>}
          </button>
        </div>
      </div>

      {/* Change Password */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Key size={16} color="#06b6d4" />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Change Password</span>
        </div>
        <form onSubmit={handleChangePassword}>
          <div className="form-group">
            <label>Current Password</label>
            <input type="password" value={pwForm.currentPassword} onChange={e => setPwForm({ ...pwForm, currentPassword: e.target.value })} required />
          </div>
          <div className="form-row form-row-2">
            <div className="form-group">
              <label>New Password</label>
              <input type="password" value={pwForm.newPassword} onChange={e => setPwForm({ ...pwForm, newPassword: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input type="password" value={pwForm.confirm} onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })} required />
            </div>
          </div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 14 }}>Minimum 12 characters required.</div>
          <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Changing...' : 'Change Password'}</button>
        </form>
      </div>

      {/* MFA */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Smartphone size={16} color="#8b5cf6" />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Two-Factor Authentication</span>
        </div>
        {!user?.mfa_enabled && !mfaSetup && (
          <>
            <p style={{ color: 'var(--text-muted)', marginBottom: 14 }}>Protect your account with an authenticator app.</p>
            <button className="btn btn-primary" onClick={handleSetupMFA}>Setup MFA</button>
          </>
        )}
        {mfaSetup && (
          <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 14 }}>Scan this QR code, then enter the 6-digit code:</p>
            <img src={mfaSetup.qrCode} alt="MFA QR" style={{ width: 180, height: 180, borderRadius: 8, background: '#fff', padding: 8, display: 'block', marginBottom: 14 }} />
            <div style={{ color: 'var(--text-muted)', marginBottom: 14 }}>Manual key: <span className="mono" style={{ color: 'var(--accent)' }}>{mfaSetup.secret}</span></div>
            <div className="form-group" style={{ maxWidth: 200 }}>
              <label>Verification Code</label>
              <input value={mfaCode} onChange={e => setMfaCode(e.target.value)} placeholder="000000" maxLength={6} className="mono" style={{ letterSpacing: '0.2em', textAlign: 'center' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleEnableMFA}>Enable MFA</button>
              <button className="btn btn-secondary" onClick={() => setMfaSetup(null)}>Cancel</button>
            </div>
          </div>
        )}
        {user?.mfa_enabled && !mfaSetup && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={18} color="#10b981" />
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#10b981' }}>MFA is active</div>
              <div style={{ color: 'var(--text-muted)' }}>Your account is protected with TOTP.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
