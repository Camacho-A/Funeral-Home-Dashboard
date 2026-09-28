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
 * dataAdapterMode already established.
 *
 * Manors launch-prep: two independent visibility mechanisms, layered on
 * top of the existing `authAdapterMode` gate, neither of which changes
 * what any route/API actually authorizes server-side —
 *   1. Audit/Templates are additionally gated on the viewer's own
 *      permissions (via useMyPermissions) — previously every staff
 *      member saw these links regardless of whether they could use them.
 *   2. Resources/Merchandise/Inventory/Suppliers/Purchase Orders/Accounts
 *      Payable/Calendar Integrations are additionally gated on the
 *      organization's `enabledModules` (see domain/organization/
 *      moduleVisibility.ts) — hidden by default, reachable directly by
 *      URL, RBAC-enforced exactly as before.
 *
 * Item #5 (2026-09, navigation cleanup): Import Existing Jotform Case,
 * Security, Roles, and Case Numbering no longer have their own top-level
 * entries here — they're organized under the Sidebar's "Settings"
 * destination instead (see app/(portal)/settings/SettingsHub.tsx). Nothing
 * about their own routes/permissions/business logic changed — only where
 * staff discover them from. Audit/Templates/Resources/Merchandise/etc.
 * below are untouched; they weren't part of this item's scope.
 */
export function TopBar({
  onNewCaseClick,
  authAdapterMode,
}: {
  onNewCaseClick?: () => void;
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
      {authAdapterMode === 'identity' && <OrganizationSwitcher />}
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
      <NotificationBell />
      <span className={styles.employeeName}>{session.displayName}</span>
      <UserAvatar initials={initialsFromName(session.displayName)} />
      <form action={logoutAction}>
        <button type="submit" className={styles.signOutButton}>
          Sign out
        </button>
      </form>
    </div>
  );
}
