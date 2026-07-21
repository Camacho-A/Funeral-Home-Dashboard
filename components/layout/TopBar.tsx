'use client';

import { Button } from '@/components/ui/Button';
import { useSession } from '@/hooks/useSession';
import { useCaseSearch } from '@/hooks/useCaseSearch';
import { initialsFromName } from '@/utils/string';
import { logoutAction } from '@/app/login/actions';
import { SearchInput } from './SearchInput';
import { UserAvatar } from './UserAvatar';
import styles from './TopBar.module.css';

/**
 * Persistent top bar (Frontend Engineering Plan, Phase 2/4/5).
 *
 * Search now reads/writes the shared useCaseSearch() context (Phase 5) —
 * resolving the Phase 2 placeholder. The box is always visible here (shared
 * chrome) but, matching the prototype, only the Dashboard's case list
 * actually reads its value; other screens simply don't consume it.
 *
 * The avatar reflects useSession()'s mock signed-in staff member (Phase 4)
 * rather than a hardcoded "MC" — a deliberate, documented deviation from
 * the prototype's static text, since "MC" there was never actually tied to
 * any staff record and this hook's whole purpose is to make it real data.
 *
 * `onNewCaseClick` is a no-op placeholder until Phase 9 wires it to
 * NewCaseModal.
 *
 * The "Sign out" form (Phase 13) posts directly to logoutAction — a
 * Server Action imported straight into this Client Component, no
 * client-side auth logic added here at all, matching "keep authentication
 * and authorization logic out of presentational React components."
 */
export function TopBar({ onNewCaseClick }: { onNewCaseClick?: () => void }) {
  const { query, setQuery } = useCaseSearch();
  const session = useSession();

  return (
    <div className={styles.topBar}>
      <SearchInput value={query} onChange={setQuery} />
      <div className={styles.spacer} />
      <Button onClick={onNewCaseClick}>+ New Case</Button>
      <UserAvatar initials={initialsFromName(session.displayName)} />
      <form action={logoutAction}>
        <button type="submit" className={styles.signOutButton}>
          Sign out
        </button>
      </form>
    </div>
  );
}
