'use client';

import type { AuthAdapterMode } from '@/lib/env';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/hooks/useSession';
import { useCaseSearch } from '@/hooks/useCaseSearch';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { useMyPermissions } from '@/hooks/useRbac';
import { isModuleEnabled } from '@/domain/organization/moduleVisibility';
import { initialsFromName } from '@/utils/string';
import { logoutAction } from '@/app/login/actions';
import { SearchInput } from './SearchInput';
import { UserAvatar } from './UserAvatar';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { NotificationBell } from './NotificationBell';
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
 *
 * Phase 21 (Identity, Authentication & Session Management): `authAdapterMode`
 * is server-resolved by app/(portal)/layout.tsx and threaded down through
 * AppShell, the same trusted-server-value pattern OrganizationProvider's
 * dataAdapterMode already established — the "Security" link (Change
 * Password / Manage Sessions) only renders for `'identity'` sessions,
 * since it's the only mode with anything there to manage.
 *
 * Manors launch-prep: two independent visibility mechanisms, layered on
 * top of the existing `authAdapterMode` gate, neither of which changes
 * what any route/API actually authorizes server-side —
 *   1. Roles/Team/Audit/Templates are additionally gated on the viewer's
 *      own permissions (via useMyPermissions) — previously every staff
 *      member saw these links regardless of whether they could use them.
 *   2. Resources/Merchandise/Inventory/Suppliers/Purchase Orders/Accounts
 *      Payable/Calendar Integrations are additionally gated on the
 *      organization's `enabledModules` (see domain/organization/
 *      moduleVisibility.ts) — hidden by default, reachable directly by
 *      URL, RBAC-enforced exactly as before.
 */
export function TopBar({
  onNewCaseClick,
  onImportHistoricalCaseClick,
  authAdapterMode,
}: {
  onNewCaseClick?: () => void;
  onImportHistoricalCaseClick?: () => void;
  authAdapterMode?: AuthAdapterMode;
}) {
  const { query, setQuery } = useCaseSearch();
  const session = useSession();
  const { organizationId } = useOrganization();
  const { data: organization } = useOrganizationRecord();
  const { data: myPermissions } = useMyPermissions(organizationId);
  const permissions = myPermissions?.permissions ?? [];

  return (
    <div className={styles.topBar}>
      <SearchInput value={query} onChange={setQuery} />
      <div className={styles.spacer} />
      <Button onClick={onNewCaseClick}>+ New Case</Button>
      {permissions.includes('case.create') && (
        <button type="button" className={styles.signOutButton} onClick={onImportHistoricalCaseClick}>
          Import Existing Jotform Case
        </button>
      )}
      {authAdapterMode === 'identity' && <OrganizationSwitcher />}
      {authAdapterMode === 'identity' && (
        <a href="/settings/security" className={styles.signOutButton}>
          Security
        </a>
      )}
      {authAdapterMode === 'identity' && permissions.includes('user.manageRoles') && (
        <a href="/settings/roles" className={styles.signOutButton}>
          Roles
        </a>
      )}
      {authAdapterMode === 'identity' && permissions.includes('user.invite') && (
        <a href="/settings/team" className={styles.signOutButton}>
          Team
        </a>
      )}
      {authAdapterMode === 'identity' && permissions.includes('audit.read') && (
        <a href="/settings/audit" className={styles.signOutButton}>
          Audit
        </a>
      )}
      {authAdapterMode === 'identity' && permissions.includes('document.template.manage') && (
        <a href="/settings/document-templates" className={styles.signOutButton}>
          Templates
        </a>
      )}
      {isModuleEnabled(organization, 'resources') && (
        <a href="/settings/resources" className={styles.signOutButton}>
          Resources
        </a>
      )}
      {isModuleEnabled(organization, 'merchandise') && (
        <a href="/settings/merchandise" className={styles.signOutButton}>
          Merchandise
        </a>
      )}
      {isModuleEnabled(organization, 'inventory') && (
        <a href="/settings/inventory" className={styles.signOutButton}>
          Inventory
        </a>
      )}
      {isModuleEnabled(organization, 'procurement') && (
        <a href="/settings/suppliers" className={styles.signOutButton}>
          Suppliers
        </a>
      )}
      {isModuleEnabled(organization, 'procurement') && (
        <a href="/settings/purchase-orders" className={styles.signOutButton}>
          Purchase Orders
        </a>
      )}
      {isModuleEnabled(organization, 'accountsPayable') && (
        <a href="/settings/accounts-payable" className={styles.signOutButton}>
          Accounts Payable
        </a>
      )}
      {isModuleEnabled(organization, 'calendarIntegrations') && (
        <a href="/settings/calendar-integrations" className={styles.signOutButton}>
          Calendar
        </a>
      )}
      {permissions.includes('organization.manage') && (
        <a href="/settings/case-numbering" className={styles.signOutButton}>
          Case Numbering
        </a>
      )}
      <NotificationBell />
      <UserAvatar initials={initialsFromName(session.displayName)} />
      <form action={logoutAction}>
        <button type="submit" className={styles.signOutButton}>
          Sign out
        </button>
      </form>
    </div>
  );
}
