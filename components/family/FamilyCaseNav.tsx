'use client';

import { usePathname } from 'next/navigation';
import styles from './FamilyCaseNav.module.css';

const SECTIONS = [
  { slug: '', label: 'Overview' },
  { slug: 'documents', label: 'Documents' },
  { slug: 'signatures', label: 'Signatures' },
  { slug: 'payments', label: 'Payments' },
  { slug: 'appointments', label: 'Appointments' },
  { slug: 'messages', label: 'Messages' },
];

/**
 * Phase 29 (Family Portal & External Collaboration). The horizontal,
 * scrollable sub-nav for one case's five sections — real navigation (each
 * section is its own route, per the approved plan's `/family/cases/[caseId]`
 * + `/documents`/`/signatures`/`/payments`/`/appointments`/`/messages`
 * structure), not client-side tab state, so each section is independently
 * linkable/refreshable.
 */
export function FamilyCaseNav({ caseId }: { caseId: string }) {
  const pathname = usePathname();
  const basePath = `/family/cases/${caseId}`;

  return (
    <nav className={styles.nav} aria-label="Case sections">
      {SECTIONS.map((section) => {
        const href = section.slug ? `${basePath}/${section.slug}` : basePath;
        const isActive = pathname === href;
        return (
          <a key={section.slug} href={href} className={isActive ? styles.itemActive : styles.item}>
            {section.label}
          </a>
        );
      })}
    </nav>
  );
}
