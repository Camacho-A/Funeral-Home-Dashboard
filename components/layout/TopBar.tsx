'use client';

import type { AuthAdapterMode } from '@/lib/env';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/hooks/useSession';
import { useCaseSearch } from '@/hooks/useCaseSearch';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { isModuleEnabled } from '@/domain/organization/moduleVisibility';
import { initialsFromName } from '@/utils/string';
import { SearchInput } from './SearchInput';
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
 * SOLIS Final Phase (2026-10): the standalone desktop Audit/Templates
 * `<a>` links are gone — AccountMenu's popover (`Audit Center`/
 * `Templates`) is now their only destination, at every width.
 * `showAudit`/`showTemplates` are still computed once, right here, from
 * the same `authAdapterMode === 'identity' && permissions.includes(...)`
 * checks as before — AccountMenu has no permission logic of its own.
 *
 * SOLIS true redesign, Phase 1 (2026-10): the prior dual identity
 * representation (an always-visible desktop name+avatar+standalone-
 * Sign-out-form group, CSS-hidden on mobile, alongside a second,
 * mobile-only AccountMenu) is now just AccountMenu, rendered once, at
 * every width — the approved design's own "compact avatar trigger, no new
 * destinations" direction. Sign out, Audit (now labeled "Audit Center")
 * and Templates live in its popover; nothing about `logoutAction`, the
 * Server Action it posts to, or Audit/Templates' routes/permissions
 * changed.
 *
 * SOLIS Final Phase (2026-10, §1.1): the standalone desktop Audit/
 * Templates `<a>` links are removed outright (not just mobile-hidden) —
 * AccountMenu's popover is their only destination at every width now.
 * Resources/Merchandise/Inventory/Suppliers/Purchase Orders/Accounts
 * Payable/Calendar Integrations and OrganizationSwitcher are deliberately
 * NOT in the final-phase design spec at all (desktop screenshots only
 * showed `authAdapterMode !== 'identity'`, module-disabled Manor's) —
 * kept exactly as they were (own doc comment above, own `.overflowLink`/
 * `.divider` treatment) rather than silently stripping working navigation
 * for other organizations/modes the design wasn't exercised against.
 *
 * Addendum 2, item #5 (2026-10): "Audit Center" and "Templates" moved out
 * of AccountMenu's popover entirely, into the Settings menu (see
 * `app/(portal)/settings/settingsAreas.ts`) — every mention of them above
 * describes history, not current behavior. This component no longer
 * computes their visibility at all; `useMyPermissions`/`organizationId`
 * were removed here along with the `showAudit`/`showTemplates` props,
 * since nothing else in this file used them.
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
  const { data: organization } = useOrganizationRecord();

  return (
    <div className={styles.topBar}>
      <button type="button" className={styles.menuButton} onClick={onMenuClick} aria-label="Open navigation menu">
        <span className={styles.menuIcon} aria-hidden="true" />
      </button>
      <div className={styles.mobileBrand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/soliscode-mark.png" alt="" aria-hidden="true" className={styles.mobileBrandMark} />
        <span className={styles.mobileBrandWordmark}>SOLIS</span>
      </div>
      <SearchInput value={query} onChange={setQuery} className={styles.searchSlot} hint="⌘K" />
      <div className={styles.spacer} />
      {authAdapterMode === 'identity' && <OrganizationSwitcher />}
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
      <div className={styles.divider} aria-hidden="true" />
      <div className={styles.identityGroup}>
        <NotificationBell />
        <Button onClick={onNewCaseClick} className={styles.newCaseButton} style={{ marginLeft: 4 }}>
          <span aria-hidden="true">+</span> <span className={styles.newCaseLabelFull}>New Case</span>
          <span className={styles.newCaseLabelShort}>New</span>
        </Button>
        <div style={{ marginLeft: 6 }}>
          <AccountMenu initials={initialsFromName(session.displayName)} displayName={session.displayName} email={session.email} />
        </div>
      </div>
    </div>
  );
}
