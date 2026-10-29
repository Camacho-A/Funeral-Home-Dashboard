'use client';

import { useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCrematoryCaseSummary, type CrematoryCaseSummary } from '@/lib/crematoryClient';
import { ReplacePermitButton } from '@/components/crematory/ReplacePermitButton';
import { caseDocumentsKey } from '@/hooks/useCaseDocumentLibrary';
import { formatTimestamp } from '@/utils/format';
import styles from './CrematoryPackageStatus.module.css';

/**
 * Crematory Package status on the case's Documents tab (2026-10): the
 * documents the package is made from — the Arrangement Form's page 3, the
 * state permit — and the package itself, each with what (if anything) it
 * still needs. SOLIS prepares page 3 and the package itself; staff confirm
 * the permit, name and date in Send to Crematory. The one action here is
 * Replace permit (2026-10), for staff who prepare packages, before the
 * case is sent.
 */
const ROWS: Array<{ key: string; label: string }> = [
  { key: 'crematory_form', label: 'Arrangement Form page 3 (Crematory Form)' },
  { key: 'permit_uploaded', label: 'State Cremation Permit' },
  { key: 'permit_verified', label: 'Permit confirmed for this decedent' },
  { key: 'workflow_2', label: 'Workflow 2 complete' },
  { key: 'package_name', label: 'Name for the file confirmed' },
  { key: 'ready_date', label: 'Expected ready date confirmed' },
];

/** Whether SOLIS is expected to prepare something for this case now: page 3
    from an Arrangement Form already on it, or the package from sources in
    place — never for a case sent or being sent. */
export function preparationDue(s: CrematoryCaseSummary): boolean {
  if (!s.readiness?.requirements || s.lastSubmission?.status === 'submitted' || s.lastSubmission?.status === 'uncertain') return false;
  const form = s.readiness.requirements.find((r) => r.key === 'crematory_form');
  const page3Due = form !== undefined && !form.ok && !/not been received/i.test(form.detail ?? '');
  return page3Due || (s.readiness.readyToBuild && s.package?.current !== true);
}

/**
 * The panel's one-line status (2026-10), from the server's own readiness —
 * never from the PDF existing alone:
 *   sent through SOLIS · send unclear · last send failed · recorded as sent
 *   outside SOLIS · possible earlier send to verify · being prepared ·
 *   ready for final review and sending · package prepared but something
 *   still required before sending (named) · needs attention.
 * The viewer's own send permission is not part of it — the case's
 * readiness is the same whoever looks at it.
 */
export function packageHeadline(s: CrematoryCaseSummary): { text: string; tone: 'ok' | 'warn' | 'neutral' } {
  if (s.lastSubmission?.status === 'submitted') return { text: `Sent to the crematory ${formatTimestamp(s.lastSubmission.at)}`, tone: 'ok' };
  if (s.lastSubmission?.status === 'uncertain') return { text: 'Send outcome unclear — check Sent Items in Send to Crematory', tone: 'warn' };
  if (s.previousSend?.recorded?.decision === 'sent_outside_solis') return { text: 'Recorded as sent outside SOLIS', tone: 'neutral' };
  if (s.previousSend?.indicated) return { text: 'Possible earlier send — verify it in Send to Crematory', tone: 'warn' };
  const failedNote = s.lastSubmission?.status === 'failed' ? ' (the last send failed)' : '';
  if (preparationDue(s)) return { text: `Being prepared${failedNote}`, tone: 'neutral' };
  if (s.package?.current) {
    const blocking = s.readiness.requirements.filter((r) => !r.ok && r.key !== 'permission' && r.key !== 'package');
    if (blocking.length === 0) return { text: `Ready for final review and sending${failedNote}`, tone: 'ok' };
    if (blocking.some((r) => r.key === 'workflow_2')) return { text: 'Package prepared — Workflow 2 required before sending.', tone: 'warn' };
    return { text: `Package prepared — ${blocking[0].label} required before sending.`, tone: 'warn' };
  }
  return { text: `${s.package ? 'Outdated — needs attention' : 'Needs attention'}${failedNote}`, tone: 'warn' };
}

export function CrematoryPackageStatus({ organizationId, caseId }: { organizationId: string; caseId: string }) {
  const queryClient = useQueryClient();
  // SOLIS prepares page 3 and the package after an upload or a change
  // (2026-10): while that is due, check again every few seconds — for up
  // to two minutes — so the panel updates without reopening the case.
  const pollingSince = useRef<number | null>(null);
  const summary = useQuery({
    queryKey: ['crematory', organizationId, 'case', caseId],
    queryFn: () => fetchCrematoryCaseSummary(organizationId, caseId),
    staleTime: 0,
    refetchInterval: (query) => {
      const due = query.state.data ? preparationDue(query.state.data) : false;
      if (!due) {
        pollingSince.current = null;
        return false;
      }
      pollingSince.current ??= Date.now();
      return Date.now() - pollingSince.current < 120_000 ? 3_000 : false;
    },
  });
  const s = summary.data;
  if (!s?.readiness?.requirements) return null;
  if (!s.readiness.requirements.find((r) => r.key === 'cremation')?.ok) return null;
  const headline = packageHeadline(s);
  const requirement = (key: string) => s.readiness.requirements.find((r) => r.key === key);
  const canReplace = s.canPrepare === true && s.permit !== null && (!s.lastSubmission || s.lastSubmission.status === 'failed');
  const replaced = () =>
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['crematory', organizationId] }),
      queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, caseId) }),
    ]);
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
      {s.previousSend?.indicated && (
        <p className={styles.detail} role="alert">
          This case indicates that documents may already have been sent to the crematory outside SOLIS. Verify the previous send in Send to Crematory before continuing.
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
              {key === 'permit_uploaded' && s.permit && (
                <>
                  <span className={styles.detail}> — {s.permit.fileName}</span>{' '}
                  {canReplace && r.ok && <ReplacePermitButton organizationId={organizationId} caseId={caseId} decedentDisplayName={s.decedentDisplayName} permit={s.permit} onReplaced={replaced} />}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
