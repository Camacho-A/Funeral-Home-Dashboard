'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { useMyPermissions } from '@/hooks/useRbac';
import { isModuleEnabled } from '@/domain/organization/moduleVisibility';
import styles from './AccountingNav.module.css';

const LINKS = [
  { href: '/accounting', label: 'Dashboard' },
  { href: '/accounting/chart-of-accounts', label: 'Chart of Accounts' },
  { href: '/accounting/journal-entries', label: 'Journal Entries' },
  { href: '/accounting/banking', label: 'Banking' },
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
    without touching the (already-correct) server-side data protection. */
export function AccountingNav() {
  const pathname = usePathname();
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const { data: organization } = useOrganizationRecord();
  const canViewAccounting = (myPermissionsQuery.data?.permissions ?? []).includes('accounting.view');

  if (!canViewAccounting) return null;

  const visibleLinks = LINKS.filter((link) => !link.requiresModule || isModuleEnabled(organization, link.requiresModule));

  return (
    <nav className={styles.nav} aria-label="Accounting">
      {visibleLinks.map((link) => {
        const isActive = pathname === link.href || (link.href !== '/accounting' && pathname?.startsWith(link.href));
        return (
          <Link key={link.href} href={link.href} className={`${styles.link} ${isActive ? styles.linkActive : ''}`}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
