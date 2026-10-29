'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchCrematoryCaseSummary, type CrematoryCaseSummary } from '@/lib/crematoryClient';
import { formatTimestamp } from '@/utils/format';
import styles from './CrematoryPackageStatus.module.css';

/**
 * Crematory Package status on the case's Documents tab (2026-10): the
 * documents the package is made from — the Arrangement Form's page 3, the
 * state permit — and the package itself, each with what (if anything) it
 * still needs. Read-only: SOLIS prepares page 3 and the package itself;
 * staff confirm the permit, name and date in Send to Crematory.
 */
const ROWS: Array<{ key: string; label: string }> = [
  { key: 'crematory_form', label: 'Arrangement Form page 3 (Crematory Form)' },
  { key: 'permit_uploaded', label: 'State Cremation Permit' },
  { key: 'permit_verified', label: 'Permit confirmed for this decedent' },
  { key: 'workflow_2', label: 'Workflow 2 complete' },
  { key: 'package_name', label: 'Name for the file confirmed' },
  { key: 'ready_date', label: 'Expected ready date confirmed' },
];

export function packageHeadline(s: CrematoryCaseSummary): { text: string; tone: 'ok' | 'warn' | 'neutral' } {
  if (s.lastSubmission?.status === 'submitted') return { text: `Sent to the crematory ${formatTimestamp(s.lastSubmission.at)}`, tone: 'ok' };
  if (s.lastSubmission?.status === 'uncertain') return { text: 'Send outcome unclear — check Sent Items in Send to Crematory', tone: 'warn' };
  if (s.package?.current) return { text: 'Ready', tone: 'ok' };
  if (s.readiness.readyToBuild) return { text: 'Being prepared', tone: 'neutral' };
  return { text: s.package ? 'Outdated — needs attention' : 'Needs attention', tone: 'warn' };
}

export function CrematoryPackageStatus({ organizationId, caseId }: { organizationId: string; caseId: string }) {
  const summary = useQuery({ queryKey: ['crematory', organizationId, 'case', caseId], queryFn: () => fetchCrematoryCaseSummary(organizationId, caseId), staleTime: 0 });
  const s = summary.data;
  if (!s?.readiness?.requirements) return null;
  if (!s.readiness.requirements.find((r) => r.key === 'cremation')?.ok) return null;
  const headline = packageHeadline(s);
  const requirement = (key: string) => s.readiness.requirements.find((r) => r.key === key);
  return (
    <section className={styles.panel} aria-label="Crematory Package">
      <div className={styles.head}>
        <h3 className={styles.title}>Crematory Package</h3>
        <span className={`sx-status ${headline.tone === 'ok' ? 'sx-status-ok' : headline.tone === 'warn' ? 'sx-status-warn' : ''}`}>{headline.text}</span>
      </div>
      {s.package && (
        <p className={styles.file}>
          {s.package.fileName}
          {s.package.version !== null ? ` · v${s.package.version}` : ''}
        </p>
      )}
      <ul className={styles.list}>
        {ROWS.map(({ key, label }) => {
          const r = requirement(key);
          if (!r) return null;
          return (
            <li key={key}>
              <span className={r.ok ? styles.ok : styles.todo} aria-hidden="true">
                {r.ok ? '✓' : '●'}
              </span>{' '}
              {label}
              {!r.ok && r.detail ? <span className={styles.detail}> — {r.detail}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
