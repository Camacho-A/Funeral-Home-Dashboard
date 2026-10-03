'use client';

import { useEffect, useRef, useState } from 'react';

export type RowMenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; dividerBefore?: boolean; href?: string };

/**
 * SOLIS Final Phase, §0.7 — shared row "⋯" menu. Same open/close pattern as
 * AccountMenu.tsx: outside mousedown and Escape both close it.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="sx-menu-root" ref={rootRef}>
      <button type="button" className="sx-icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="sx-menu" role="menu">
          {items.map((item) => (
            <div key={item.label} style={{ display: 'contents' }}>
              {item.dividerBefore && <div className="sx-menu-divider" role="separator" />}
              {item.href ? (
                <a role="menuitem" href={item.href} className={`sx-menu-item ${item.danger ? 'sx-menu-item-danger' : ''}`} onClick={() => setOpen(false)}>
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={`sx-menu-item ${item.danger ? 'sx-menu-item-danger' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
