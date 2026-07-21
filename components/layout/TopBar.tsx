'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/hooks/useSession';
import { initialsFromName } from '@/utils/string';
import { SearchInput } from './SearchInput';
import { UserAvatar } from './UserAvatar';
import styles from './TopBar.module.css';

/**
 * Persistent top bar (Frontend Engineering Plan, Phase 2/4).
 *
 * Search is controlled-or-uncontrolled: Phase 5 (Dashboard) is expected to
 * pass `searchValue`/`onSearchChange` (likely backed by a URL search param,
 * decided when Dashboard is built, since the search box is shared chrome but
 * only Dashboard's case list actually reads it — see docs/UI_COMPONENTS.md).
 * Until then, TopBar falls back to harmless local state so it's visually and
 * functionally complete on its own.
 *
 * The avatar now reflects useSession()'s mock signed-in staff member (Phase
 * 4) rather than a hardcoded "MC" — a deliberate, documented deviation from
 * the prototype's static text, since "MC" there was never actually tied to
 * any staff record and this hook's whole purpose is to make it real data.
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
  const session = useSession();

  return (
    <div className={styles.topBar}>
      <SearchInput value={value} onChange={handleChange} />
      <div className={styles.spacer} />
      <Button onClick={onNewCaseClick}>+ New Case</Button>
      <UserAvatar initials={initialsFromName(session.displayName)} />
    </div>
  );
}
