import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, total, limit, onPageChange, onLimitChange }) {
  const totalPages = Math.ceil(total / limit);
  if (total === 0) return null;

  const limits = [15, 30, 45, 60, 100];
  const start  = (page - 1) * limit + 1;
  const end    = Math.min(page * limit, total);

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:16, flexWrap:'wrap', gap:12 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--text-muted)' }}>
        <span>Show</span>
        <select
          value={limit}
          onChange={e => { onLimitChange(parseInt(e.target.value)); onPageChange(1); }}
          style={{ width:'auto', padding:'4px 8px' }}
        >
          {limits.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <span>per page · {start}–{end} of {total}</span>
      </div>

      <div style={{ display:'flex', gap:4, alignItems:'center' }}>
        <button
          className="btn btn-secondary btn-sm"
          disabled={page === 1}
          onClick={() => onPageChange(1)}
          style={{ padding:'4px 8px' }}
        >«</button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          style={{ padding:'4px 8px' }}
        ><ChevronLeft size={14}/></button>

        {/* Page numbers */}
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          let p;
          if (totalPages <= 5) p = i + 1;
          else if (page <= 3) p = i + 1;
          else if (page >= totalPages - 2) p = totalPages - 4 + i;
          else p = page - 2 + i;
          return (
            <button key={p}
              onClick={() => onPageChange(p)}
              className={`btn btn-sm ${page === p ? 'btn-primary' : 'btn-secondary'}`}
              style={{ minWidth:32, padding:'4px 8px' }}
            >{p}</button>
          );
        })}

        <button
          className="btn btn-secondary btn-sm"
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          style={{ padding:'4px 8px' }}
        ><ChevronRight size={14}/></button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={page === totalPages}
          onClick={() => onPageChange(totalPages)}
          style={{ padding:'4px 8px' }}
        >»</button>
      </div>
    </div>
  );
}
