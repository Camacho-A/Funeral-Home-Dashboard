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
import { AccountMenu } from './AccountMenu';
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
 *
 * Mobile navigation drawer (2026-09): `onMenuClick` is new and optional —
 * when provided, a hamburger button renders first (hidden above the
 * shared 860px breakpoint in TopBar.module.css, alongside the matching
 * Sidebar.module.css drawer it opens).
 *
 * Mobile TopBar design correction (2026-09): below that same breakpoint,
 * the first wrap-to-new-row pass (plain `flex-wrap`, DOM order) read as a
 * tall, awkwardly-wrapped desktop header rather than a real mobile
 * design. This replaces it with a deliberate two-row mobile layout — row
 * one is hamburger (pinned left) plus New Case/Notifications/account
 * avatar grouped and pushed to the right edge via a single
 * `margin-left: auto` (no wrapper container, no spacer element — see
 * TopBar.module.css's own comment), the expanded search bar alone on row
 * two, anything else (Org Switcher, Resources/Merchandise/Inventory/
 * Suppliers/Purchase Orders/Accounts Payable/Calendar Integrations —
 * module-gated links) wrapping below that.
 *
 * Mobile TopBar — Audit/Templates moved into AC menu (2026-09): Audit
 * and Templates no longer appear in the mobile top row at all (CSS-
 * hidden, not reordered) — they're only reachable there through the
 * AccountMenu popover now, alongside Sign out. `showAudit`/
 * `showTemplates` are computed once, right here, from the EXACT same
 * `authAdapterMode === 'identity' && permissions.includes(...)` checks
 * this component's own (desktop) `<a>` elements already use just below —
 * AccountMenu has no permission logic of its own, and its `<a href>`
 * destinations are identical to these. Employee name and the standalone
 * "Sign out" link are CSS-hidden on mobile only; AccountMenu is what
 * replaces all three (name, Sign out, and now Audit/Templates) there —
 * see its own doc comment for why these dual representations exist in
 * the DOM. Desktop (above 860px) is unchanged: same DOM, same classes,
 * same visual order and content — Audit/Templates still render as their
 * original, always-visible top-row links there.
 */
export function TopBar({
  onNewCaseClick,
  onMenuClick,
  authAdapterMode,
}: {
  onNewCaseClick?: () => void;
  onMenuClick?: () => void;
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
      <button type="button" className={styles.menuButton} onClick={onMenuClick} aria-label="Open navigation menu">
        <span className={styles.menuIcon} aria-hidden="true" />
      </button>
      <SearchInput value={query} onChange={setQuery} className={styles.searchSlot} />
      <div className={styles.spacer} />
      <Button onClick={onNewCaseClick} className={styles.newCaseButton}>
        + New Case
      </Button>
      {authAdapterMode === 'identity' && <OrganizationSwitcher />}
      {authAdapterMode === 'identity' && permissions.includes('audit.read') && (
        <a href="/settings/audit" className={`${styles.signOutButton} ${styles.priorityLink}`}>
          Audit
        </a>
      )}
      {authAdapterMode === 'identity' && permissions.includes('document.template.manage') && (
        <a href="/settings/document-templates" className={`${styles.signOutButton} ${styles.priorityLink}`}>
          Templates
        </a>
      )}
      {isModuleEnabled(organization, 'resources') && (
        <a href="/settings/resources" className={`${styles.signOutButton} ${styles.overflowLink}`}>
          Resources
        </a>
      )}
      {isModuleEnabled(organization, 'merchandise') && (
        <a href="/settings/merchandise" className={`${styles.signOutButton} ${styles.overflowLink}`}>
          Merchandise
        </a>
      )}
      {isModuleEnabled(organization, 'inventory') && (
        <a href="/settings/inventory" className={`${styles.signOutButton} ${styles.overflowLink}`}>
          Inventory
        </a>
      )}
      {isModuleEnabled(organization, 'procurement') && (
        <a href="/settings/suppliers" className={`${styles.signOutButton} ${styles.overflowLink}`}>
          Suppliers
        </a>
      )}
      {isModuleEnabled(organization, 'procurement') && (
        <a href="/settings/purchase-orders" className={`${styles.signOutButton} ${styles.overflowLink}`}>
          Purchase Orders
        </a>
      )}
      {isModuleEnabled(organization, 'accountsPayable') && (
        <a href="/settings/accounts-payable" className={`${styles.signOutButton} ${styles.overflowLink}`}>
          Accounts Payable
        </a>
      )}
      {isModuleEnabled(organization, 'calendarIntegrations') && (
        <a href="/settings/calendar-integrations" className={`${styles.signOutButton} ${styles.overflowLink}`}>
          Calendar
        </a>
      )}
      <div className={styles.identityGroup}>
        <NotificationBell />
        <div className={styles.desktopAccountGroup}>
          <span className={styles.employeeName}>{session.displayName}</span>
          <UserAvatar initials={initialsFromName(session.displayName)} />
          <form action={logoutAction}>
            <button type="submit" className={styles.signOutButton}>
              Sign out
            </button>
          </form>
        </div>
        <div className={styles.mobileAccountSlot}>
          <AccountMenu
            initials={initialsFromName(session.displayName)}
            displayName={session.displayName}
            showAudit={authAdapterMode === 'identity' && permissions.includes('audit.read')}
            showTemplates={authAdapterMode === 'identity' && permissions.includes('document.template.manage')}
          />
        </div>
      </div>
    </div>
  );
}
