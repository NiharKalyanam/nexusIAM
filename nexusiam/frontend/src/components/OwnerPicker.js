import React, { useState, useEffect, useRef } from 'react';
import API from '../utils/api';

/**
 * OwnerPicker — select an identity OR workgroup as owner
 * Props:
 *   value        : { id, name, type } | null
 *   onChange     : fn({ id, name, type, email })
 *   placeholder  : string
 *   disabled     : bool
 */
export default function OwnerPicker({ value, onChange, placeholder = 'Select identity or workgroup…', disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => search(query), 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  const search = async (q) => {
    setLoading(true);
    try {
      const { data } = await API.get('/workgroups/picker/search', { params: { q, limit: 20 } });
      setResults(data.results || []);
    } catch { setResults([]); }
    setLoading(false);
  };

  const select = (item) => {
    onChange({
      id: item.id,
      name: item.type === 'workgroup' ? item.name : (item.first_name ? `${item.first_name} ${item.last_name}` : item.name),
      type: item.type,
      email: item.email});
    setOpen(false);
    setQuery('');
  };

  const clear = (e) => { e.stopPropagation(); onChange(null); };

  const workgroups = results.filter(r => r.type === 'workgroup');
  const identities = results.filter(r => r.type === 'identity');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => { if (!disabled) { setOpen(o => !o); if (!open) search(''); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-tertiary)', border: '1px solid #2a3545',
          borderRadius: 6, padding: '7px 10px', cursor: disabled ? 'default' : 'pointer',
          minHeight: 36, opacity: disabled ? 0.6 : 1 }}
      >
        {value ? (
          <>
            <span style={{ }}>{value.type === 'workgroup' ? '👥' : '👤'}</span>
            <span style={{ flex: 1, color: 'var(--text-primary)' }}>{value.name}</span>
            {!disabled && (
              <span onClick={clear} style={{ color: 'var(--text-muted)', lineHeight: 1, cursor: 'pointer' }}>×</span>
            )}
          </>
        ) : (
          <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{placeholder}</span>
        )}
        <span style={{ color: 'var(--text-secondary)' }}>▼</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
          background: 'var(--bg-tertiary)', border: '1px solid #2a3545', borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)', marginTop: 4, maxHeight: 320, overflow: 'hidden',
          display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #1e2a3a' }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search identities and workgroups…"
              style={{
                width: '100%', background: 'var(--bg-primary)', border: '1px solid #2a3545',
                borderRadius: 4, color: 'var(--text-primary)', padding: '5px 8px',
                outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 260 }}>
            {loading && (
              <div style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>Searching…</div>
            )}
            {!loading && workgroups.length > 0 && (
              <>
                <div style={{ padding: '6px 12px 2px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Workgroups
                </div>
                {workgroups.map(item => (
                  <div key={item.id} onClick={() => select(item)}
                    style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ }}>👥</span>
                    <div>
                      <div style={{ color: '#38bdf8', fontWeight: 500 }}>{item.name}</div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {item.member_count} member{item.member_count !== 1 ? 's' : ''}
                        {item.email ? ` · ${item.email}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
            {!loading && identities.length > 0 && (
              <>
                <div style={{ padding: '6px 12px 2px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Identities
                </div>
                {identities.map(item => (
                  <div key={item.id} onClick={() => select(item)}
                    style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ }}>👤</span>
                    <div>
                      <div style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                        {item.first_name} {item.last_name}
                      </div>
                      <div style={{ color: 'var(--text-secondary)' }}>{item.email || item.name}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
            {!loading && !results.length && (
              <div style={{ padding: '16px 14px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                No results found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
