'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { useMyPermissions } from '@/hooks/useRbac';
import { isModuleEnabled, isModuleHidden } from '@/domain/organization/moduleVisibility';

const LINKS = [
  { href: '/accounting', label: 'Dashboard' },
  // Manors accounting/reports cleanup (2026-10). These three are no
  // longer unconditionally visible — hidden per-organization via
  // `hiddenModules` (opt-out, visible by default; see
  // domain/organization/moduleVisibility.ts's own comment on why this
  // is the opposite polarity from `requiresModule` below).
  { href: '/accounting/chart-of-accounts', label: 'Chart of Accounts', hiddenByModule: 'accounting-chart-of-accounts' as const },
  { href: '/accounting/journal-entries', label: 'Journal Entries', hiddenByModule: 'accounting-journal-entries' as const },
  { href: '/accounting/banking', label: 'Banking', hiddenByModule: 'accounting-banking' as const },
  // Manors branding/visibility follow-up (2026-10). Only this one link is
  // additionally gated on the `reconciliation` module — everything else
  // here is core ledger/payment infrastructure Manors actively uses.
  { href: '/accounting/reconciliation', label: 'Reconciliation', requiresModule: 'reconciliation' as const },
  { href: '/accounting/invoices', label: 'Invoices' },
  { href: '/accounting/reports/trial-balance', label: 'Reports' },
];

/** Phase 31 (Financial Management & General Ledger). The sub-nav every
    Accounting page shares — mirrors how Settings' own sub-pages present a
    consistent tab strip, so a "Reports" link from anywhere in the
    subsystem still lands the caller in the right neighborhood.
    Manors go-live hardening: gated on `accounting.view` — the same
    permission that already gates the Sidebar's "Accounting" link and
    `AccountingDashboardPanel`'s own data. Production testing showed this
    nav rendered its labels (Dashboard/Chart of Accounts/Journal
    Entries/Banking/Reconciliation/Invoices/Reports) regardless of
    permission, even though the actual financial data underneath was
    already correctly 403'd — this closes that page-structure leak
    without touching the (already-correct) server-side data protection.

    Manors accounting/reports cleanup (2026-10): Chart of Accounts/
    Journal Entries/Banking are now additionally hidden per-organization
    via `isModuleHidden` (Manors: hidden, via the override documented in
    moduleVisibility.ts — other organizations are unaffected and see
    them exactly as before). This is nav-only, the same established
    convention every key here except `reconciliation` already uses — the
    underlying pages/panels/data/permissions are completely untouched and
    still reachable by direct URL, same as before this change. */
export function AccountingNav() {
  const pathname = usePathname();
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const { data: organization } = useOrganizationRecord();
  const canViewAccounting = (myPermissionsQuery.data?.permissions ?? []).includes('accounting.view');

  if (!canViewAccounting) return null;

  const visibleLinks = LINKS.filter(
    (link) =>
      (!link.requiresModule || isModuleEnabled(organization, link.requiresModule)) &&
      (!link.hiddenByModule || !isModuleHidden(organization, link.hiddenByModule)),
  );

  return (
    <nav className="sx-subnav" aria-label="Accounting">
      {visibleLinks.map((link) => {
        const isActive = pathname === link.href || (link.href !== '/accounting' && pathname?.startsWith(link.href));
        return (
          <Link key={link.href} href={link.href} className="sx-subnav-link" aria-current={isActive ? 'page' : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
