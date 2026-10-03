'use client';

import styles from './SearchInput.module.css';

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search by name, phone, tag number…',
  className,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Mobile TopBar design correction (2026-09): lets TopBar give this its
      own orderable class (`styles.searchSlot`) for the mobile two-row
      layout — see TopBar.tsx's own comment — without this component
      needing to know anything about that layout itself. */
  className?: string;
  /** SOLIS true redesign, Phase 1 (2026-10): an optional trailing badge
      (e.g. "⌘K") rendered inside the search field, matching the approved
      design's command-bar styling. Visual only — no keyboard shortcut is
      wired up, per that design's own Implementation Notes ("visual only,
      unless a shortcut already exists"); none exists in this codebase. */
  hint?: string;
}) {
  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <svg className={styles.icon} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
      </svg>
      <input
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label="Search cases"
      />
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
