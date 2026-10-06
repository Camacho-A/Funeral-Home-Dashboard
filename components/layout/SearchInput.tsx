'use client';

import { useEffect, useRef } from 'react';
import styles from './SearchInput.module.css';

export function SearchInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search by name, phone, tag number…',
  className,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired on Enter. Lets the TopBar take the viewer to the case list,
      which is the only page that actually renders search results — before
      this, typing here did nothing at all anywhere else (see TopBar.tsx). */
  onSubmit?: () => void;
  placeholder?: string;
  /** Mobile TopBar design correction (2026-09): lets TopBar give this its
      own orderable class (`styles.searchSlot`) for the mobile two-row
      layout — see TopBar.tsx's own comment — without this component
      needing to know anything about that layout itself. */
  className?: string;
  /** SOLIS true redesign, Phase 1 (2026-10): an optional trailing badge
      (e.g. "⌘K") rendered inside the search field, matching the approved
      design's command-bar styling. As of 2026-10 the shortcut it
      advertises is really wired up (below) — the badge previously
      promised a shortcut that did nothing, which is its own small
      "search doesn't work correctly". */
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl-K focuses the search, delivering what the `hint` badge
  // claims. Ignored while the viewer is already typing in another field,
  // so it can never steal a keystroke mid-entry.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      const active = document.activeElement;
      const inOtherField =
        active instanceof HTMLElement &&
        active !== inputRef.current &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (inOtherField) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <svg className={styles.icon} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
      </svg>
      <input
        ref={inputRef}
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit?.();
          }
        }}
        placeholder={placeholder}
        aria-label="Search cases"
      />
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
