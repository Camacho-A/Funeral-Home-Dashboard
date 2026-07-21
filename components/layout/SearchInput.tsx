'use client';

import styles from './SearchInput.module.css';

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search by name, phone, tag number…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className={styles.wrapper}>
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
