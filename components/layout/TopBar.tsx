'use client';

import { useState } from 'react';
import { SearchInput } from './SearchInput';
import { UserAvatar } from './UserAvatar';
import styles from './TopBar.module.css';

/**
 * Persistent top bar (Frontend Engineering Plan, Phase 2).
 *
 * Search is controlled-or-uncontrolled: Phase 5 (Dashboard) is expected to
 * pass `searchValue`/`onSearchChange` (likely backed by a URL search param,
 * decided when Dashboard is built, since the search box is shared chrome but
 * only Dashboard's case list actually reads it — see docs/UI_COMPONENTS.md).
 * Until then, TopBar falls back to harmless local state so it's visually and
 * functionally complete on its own.
 *
 * `onNewCaseClick` is a no-op placeholder until Phase 9 wires it to
 * NewCaseModal.
 */
export function TopBar({
  searchValue,
  onSearchChange,
  onNewCaseClick,
}: {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onNewCaseClick?: () => void;
}) {
  const [internalSearch, setInternalSearch] = useState('');
  const value = searchValue ?? internalSearch;
  const handleChange = onSearchChange ?? setInternalSearch;

  return (
    <div className={styles.topBar}>
      <SearchInput value={value} onChange={handleChange} />
      <div className={styles.spacer} />
      <button type="button" className={styles.newCaseButton} onClick={onNewCaseClick}>
        + New Case
      </button>
      <UserAvatar initials="MC" />
    </div>
  );
}
