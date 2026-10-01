'use client';

import styles from './SearchInput.module.css';

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search by name, phone, tag number…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Mobile TopBar design correction (2026-09): lets TopBar give this its
      own orderable class (`styles.searchSlot`) for the mobile two-row
      layout — see TopBar.tsx's own comment — without this component
      needing to know anything about that layout itself. */
  className?: string;
}) {
  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <input
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label="Search cases"
      />
    </div>
  );
}
