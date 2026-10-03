'use client';

import type { AuthAdapterMode } from '@/lib/env';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { useOrganizationBranding } from '@/hooks/useOrganizationBranding';
import { useMyPermissions } from '@/hooks/useRbac';
import { useActiveStaffCount } from '@/hooks/useIdentitySessions';
import { SidebarNavItem } from './SidebarNavItem';
import { ProductBrand } from './ProductBrand';
import styles from './Sidebar.module.css';

/**
 * Persistent app sidebar (Frontend Engineering Plan, Phase 2). Org name
 * reads from useOrganizationRecord() (Phase 15A — Wix-backed in `wix` mode,
 * fixture-backed in `mock` mode, same Organization shape either way).
 * Falls back to the raw organizationId if the record hasn't loaded yet or
 * couldn't be found — the same "always show something" behavior the prior
 * mock-only lookup already had.
 *
 * "N staff online" (2026-09 correction): previously a hardcoded "3 staff
 * online" placeholder. Now backed by `useActiveStaffCount` — a distinct
 * count of identities with a currently valid (non-revoked, non-expired)
 * `IdentitySession` scoped to this organization (`services/sessionService.ts#countDistinctActiveStaffForOrganization`).
 * Identity-mode only, matching the Accounting link's own gate immediately
 * below — `AUTH_ADAPTER='mock'|'wix'` never populates the `sessions`
 * registry this count reads, so nothing is shown there rather than
 * fabricating a number.
 *
 * Phase 31 (Financial Management & General Ledger): `/accounting` gets its
 * own top-level entry, matching how Calendar/Tasks/Reports already got
 * theirs (not buried in Settings — this is a full subsystem). Gated on
 * `authAdapterMode === 'identity'`, the same pattern TopBar's own RBAC-only
 * links already use, since access is governed by the new `accounting.*`
 * permissions which only exist under that auth mode.
 *
 * Manors launch-prep: financial information should not be part of the
 * normal Manors employee experience, but should remain available to an
 * appropriate administrator/management role — a visibility decision, not
 * a module-activation one (Accounting is core financial infrastructure
 * Manor already actively uses via case payments/GL, unlike the genuinely
 * unused SaaS-scale modules `domain/organization/moduleVisibility.ts`
 * gates). So this link is gated on the viewer's own `accounting.view`
 * permission instead — held by administrator/manager/accounting by
 * default, not by funeralDirector/arranger/officeStaff/readOnly. Still
 * reachable by URL with `accounting.*` RBAC fully enforced regardless.
 *
 * Item #5 (2026-09, navigation cleanup): "Settings" now hides itself when
 * the viewer has no reason to be there, rather than always appearing as a
 * potentially-empty destination — mirroring the Accounting link's own
 * precedent immediately above (a *visibility* decision only; every
 * `/settings/*` route still enforces its own authorization exactly as
 * before, reachable directly by URL regardless of nav visibility). The
 * check covers the same conditions app/(portal)/settings/SettingsHub.tsx
 * uses to decide which of its cards to show (Team/Roles need
 * `authAdapterMode === 'identity'`; Security is available to any
 * identity-mode session unconditionally; Case Numbering and Import
 * Existing Jotform are org-agnostic, permission-only) — Settings is
 * shown if any one of them would be. This intentionally does NOT account
 * for the pre-existing Audit/Templates/Resources/etc. links, which were
 * out of this item's scope and are unaffected either way. Workflow
 * Templates (Task #11, 2026-09; security follow-up) is gated on
 * `workflow.publish` — included explicitly below so a hypothetical
 * custom role holding only that permission (no default role is shaped
 * this way today; Manager already has `case.create` too) still
 * discovers Settings via this link.
 *
 * Mobile navigation drawer (2026-09): `mobileOpen`/`onClose` are new and
 * optional, defaulting to "always visible, no close control" — exactly
 * desktop's prior, unchanged behavior when a caller doesn't pass them.
 * AppShell is the only caller that does, since it's the component that
 * already owns the hamburger button (in TopBar) that opens this drawer
 * and the backdrop that closes it; Sidebar itself has no opinion on WHAT
 * triggers open/close, only on how it looks once told. Below the 560px
 * breakpoint (Sidebar.module.css) this becomes a fixed, full-height,
 * slide-in panel instead of always-visible flex column; above it,
 * `mobileOpen` has no visual effect at all (the CSS that reads it only
 * exists inside that same media query).
 */
export function Sidebar({
  authAdapterMode,
  mobileOpen = false,
  onClose,
}: {
  authAdapterMode?: AuthAdapterMode;
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const { organizationId } = useOrganization();
  const { data: organization } = useOrganizationRecord();
  const organizationName = organization?.name ?? organizationId;
  const { data: branding } = useOrganizationBranding();
  const permissionsQuery = useMyPermissions(organizationId);
  const permissions = permissionsQuery.data?.permissions ?? [];
  const canViewAccounting = permissions.includes('accounting.view');
  const canSeeSettings =
    authAdapterMode === 'identity' || // Security is always available to any identity-mode session
    permissions.includes('caseNumber.manage') ||
    permissions.includes('user.manageRoles') ||
    permissions.includes('case.create') ||
    permissions.includes('workflow.publish');
  const activeStaffCountQuery = useActiveStaffCount(organizationId, authAdapterMode === 'identity');

  return (
    <nav className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`} aria-label="Primary">
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close navigation menu">
        ✕
      </button>

      <div className={styles.brand}>
        <ProductBrand markSize={26} wordmarkClassName={styles.brandWordmark} />
      </div>

      <div className={styles.navList}>
        <SidebarNavItem href="/dashboard" label="Dashboard" icon="dashboard" onNavigate={onClose} />
        <SidebarNavItem href="/tasks" label="Tasks" icon="tasks" onNavigate={onClose} />
        <SidebarNavItem href="/calendar" label="Calendar" icon="calendar" onNavigate={onClose} />
      </div>

      {/* SOLIS true redesign, Phase 1 (2026-10): Reports/Accounting grouped
          under a quiet "Insights" label, per the approved design — purely
          a visual grouping heading, not a new nav level/route. */}
      <div className={styles.groupLabel}>Insights</div>
      <div className={styles.navList}>
        <SidebarNavItem href="/reports" label="Reports" icon="reports" onNavigate={onClose} />
        {authAdapterMode === 'identity' && canViewAccounting && (
          <SidebarNavItem href="/accounting" label="Accounting" icon="accounting" onNavigate={onClose} />
        )}
      </div>

      {canSeeSettings && (
        <>
          <div className={styles.divider} />
          <div className={styles.navList}>
            <SidebarNavItem href="/settings" label="Settings" icon="settings" onNavigate={onClose} />
          </div>
        </>
      )}

      {/* Manors cleanup phase (Task #4); connected (2026-10 follow-up).
          `branding?.logoUrl` is the per-organization logo configured via
          onboarding's Branding step (types/organizationBranding.ts) —
          distinct from `ProductBrand` above, which is the SOLIS platform
          mark, not any one tenant's own logo. Manors' real logo asset
          (public/brand/manors-logo.png) is now connected via
          `organizationBrandingFixtures` in mock mode; a production
          (wix-mode) organization with no branding row configured yet
          simply renders nothing here, same as before — no further code
          change needed once one is set.
          SOLIS true redesign, Phase 1 (2026-10): the footer is now a
          compact horizontal card (logo left, name + staff-online stacked
          right) per the approved design, instead of the prior centered
          column — presentation only; the same `branding?.logoUrl`/
          `organizationName`/`activeStaffCountQuery` data, the same
          identity-mode gate. */}
      <div className={styles.footer}>
        {branding?.logoUrl && <img src={branding.logoUrl} alt={`${organizationName} logo`} className={styles.footerLogo} />}
        <div className={styles.footerText}>
          <div className={styles.footerOrgName}>{organizationName}</div>
          {authAdapterMode === 'identity' && activeStaffCountQuery.data !== undefined && (
            <div className={styles.footerStaffOnline}>
              <span className={styles.footerStaffDot} aria-hidden="true" />
              {activeStaffCountQuery.data} staff online
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
