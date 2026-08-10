'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './AccountingNav.module.css';

const LINKS = [
  { href: '/accounting', label: 'Dashboard' },
  { href: '/accounting/chart-of-accounts', label: 'Chart of Accounts' },
  { href: '/accounting/journal-entries', label: 'Journal Entries' },
  { href: '/accounting/banking', label: 'Banking' },
  { href: '/accounting/reconciliation', label: 'Reconciliation' },
  { href: '/accounting/invoices', label: 'Invoices' },
  { href: '/accounting/reports/trial-balance', label: 'Reports' },
];

/** Phase 31 (Financial Management & General Ledger). The sub-nav every
    Accounting page shares — mirrors how Settings' own sub-pages present a
    consistent tab strip, so a "Reports" link from anywhere in the
    subsystem still lands the caller in the right neighborhood. */
export function AccountingNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Accounting">
      {LINKS.map((link) => {
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
