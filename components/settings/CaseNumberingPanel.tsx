'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useManorsCutoverEligibility, useExecuteManorsCutover } from '@/hooks/useCaseNumbering';
import { formatCaseNumber } from '@/domain/cases/caseNumber';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import styles from './CaseNumberingPanel.module.css';

/**
 * Manors go-live case-number cutover (2026-09). "Settings > Case
 * Numbering." Read-only display of the current 2026 sequence state, plus
 * — for the Manors organization only, and only while the sequence is
 * still at its pre-cutover value — a one-time, confirmation-gated action
 * that establishes the next normal SOLIS-allocated case number. See
 * app/api/organization/case-sequence/manors-go-live-cutover/route.ts's
 * own doc comment for the full design and why this is a separate route
 * from the general-purpose case-sequence mechanism.
 *
 * Authorization is enforced entirely server-side (`organization.manage`)
 * — this panel renders for anyone who navigates here and simply shows
 * whatever the API returns, including an error message for a
 * non-administrator. Hiding the action is a UX nicety, never the
 * security boundary.
 */
export function CaseNumberingPanel() {
  const { organizationId } = useOrganization();
  const eligibilityQuery = useManorsCutoverEligibility(organizationId);
  const cutover = useExecuteManorsCutover(organizationId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<{ nextSequence: number } | null>(null);

  async function handleConfirm() {
    const outcome = await cutover.mutateAsync();
    setResult({ nextSequence: outcome.nextSequence });
    setConfirmOpen(false);
  }

  if (eligibilityQuery.isPending) {
    return <p>Loading case numbering…</p>;
  }
  if (eligibilityQuery.isError) {
    return <p className={styles.error}>{(eligibilityQuery.error as Error).message}</p>;
  }

  const data = eligibilityQuery.data;
  if (!data) return null;

  const currentCaseNumber = data.currentNextSequence !== null ? formatCaseNumber(data.year, data.currentNextSequence) : null;

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{data.year} Case Numbering</div>
        <div className={styles.currentNumber}>Next Case Number: {currentCaseNumber ?? '—'}</div>
      </div>

      {result && (
        <p className={styles.success}>
          Case numbering is ready. The next new SOLIS case will be {formatCaseNumber(data.year, result.nextSequence)}.
        </p>
      )}

      {!result && data.eligible && (
        <div className={styles.cutoverBox}>
          <div className={styles.sectionTitle}>Prepare SOLIS Case Numbering</div>
          <p className={styles.description}>
            Manors cases {data.historicalCaseNumbers.join(' and ')} already exist outside SOLIS and will be imported
            separately. This will make {data.firstNormalCaseNumber} the next case number assigned to a new SOLIS case.
          </p>
          <Button onClick={() => setConfirmOpen(true)}>Prepare SOLIS Case Numbering</Button>
        </div>
      )}

      {!result && !data.eligible && data.reason && <p className={styles.description}>{data.reason}</p>}

      {cutover.isError && <p className={styles.error}>{(cutover.error as Error).message}</p>}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Prepare SOLIS Case Numbering">
        <div className={styles.summaryRow}>
          <span>Current next new-case number:</span>
          <strong>{currentCaseNumber}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>After cutover:</span>
          <strong>{data.firstNormalCaseNumber}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Historical numbers preserved for import:</span>
          <strong>{data.historicalCaseNumbers.join(', ')}</strong>
        </div>
        <p className={styles.description}>
          This does not create either historical case. It only changes the next number SOLIS will assign to a newly
          created case.
        </p>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={cutover.isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={cutover.isPending}>
            {cutover.isPending ? 'Preparing…' : 'Confirm'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
