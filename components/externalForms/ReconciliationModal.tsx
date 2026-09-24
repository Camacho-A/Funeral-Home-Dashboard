'use client';

import { useEffect, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useReconciliation, useApplyReconciliation } from '@/hooks/useExternalForms';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { ReconciliationRow } from '@/domain/externalForms/reconciliation';
import styles from './ReconciliationModal.module.css';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Field-by-
 * field comparison — a conflicting value is NEVER pre-selected; only an
 * empty-in-Solis field is eligible for the bulk "Apply all new
 * information" action. Applying always goes through the existing,
 * fully-validated case-update route (see app/api/external-form-submissions/
 * [submissionId]/review/route.ts) — this component never writes a Case
 * field itself.
 */
export function ReconciliationModal({ submissionId, caseId, onClose }: { submissionId: string; caseId: string; onClose: () => void }) {
  const { organizationId } = useOrganization();
  const query = useReconciliation(organizationId, submissionId, caseId, true);
  const applyMutation = useApplyReconciliation(organizationId, caseId);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = query.data?.rows ?? [];

  useEffect(() => {
    setSelected(new Set(rows.filter((r) => r.eligibleForBulkApply).map((r) => r.field)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  function toggle(field: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function handleApply(fields: string[]) {
    await applyMutation.mutateAsync({ submissionId, fieldsToApply: fields });
    onClose();
  }

  const applicableRows = rows.filter((r) => r.state !== 'review_only');
  const reviewOnlyRows = rows.filter((r) => r.state === 'review_only');
  const emptyEligibleFields = rows.filter((r) => r.eligibleForBulkApply).map((r) => r.field);

  return (
    <Modal open onClose={onClose} title="Review Submission">
      {query.isPending ? (
        <p>Loading…</p>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th />
                <th>Field</th>
                <th>Current SOLIS Value</th>
                <th>Jotform Value</th>
              </tr>
            </thead>
            <tbody>
              {applicableRows.map((row: ReconciliationRow) => (
                <tr key={row.field}>
                  <td>
                    {row.state !== 'match' && (
                      <input
                        type="checkbox"
                        checked={selected.has(row.field)}
                        onChange={() => toggle(row.field)}
                        aria-label={`Apply ${row.field}`}
                      />
                    )}
                  </td>
                  <td>{row.field}</td>
                  <td>{row.currentValue ?? '—'}</td>
                  <td className={row.state === 'conflict' ? styles.conflictValue : undefined}>{row.incomingValue ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {reviewOnlyRows.length > 0 && (
            <p className={styles.reviewOnly}>
              Also submitted (no matching SOLIS field): {reviewOnlyRows.map((r) => `${r.field}: ${r.incomingValue}`).join(', ')}
            </p>
          )}

          <div className={styles.footer}>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <div>
              {emptyEligibleFields.length > 0 && (
                <Button variant="secondary" onClick={() => handleApply(emptyEligibleFields)} disabled={applyMutation.isPending}>
                  Apply all new information
                </Button>
              )}
              <Button onClick={() => handleApply([...selected])} disabled={applyMutation.isPending || selected.size === 0}>
                Apply selected
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
