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
/** Staff-facing names for the compared fields; anything not listed shows
    its field key, as before. */
const FIELD_LABELS: Partial<Record<ReconciliationRow['field'], string>> = {
  decedentName: 'Decedent name',
  decedentMiddleName: 'Middle name',
  decedentFirstName: 'First name (as submitted)',
  decedentLastName: 'Last name (as submitted)',
  dateOfBirth: 'Date of birth',
  dateOfDeath: 'Date of death',
  placeOfDeath: 'Place of death',
  timeOfDeath: 'Time of death',
  nextOfKinName: 'Next of kin name',
  nextOfKinRelationship: 'Next of kin relationship',
  nextOfKinPhone: 'Next of kin phone',
  nextOfKinEmail: 'Next of kin email',
  certifierName: 'Certifier name',
  certifierPhone: 'Certifier phone',
  certifierLicenseNumber: 'Certifier license #',
  certifierFax: 'Certifier fax',
};

function fieldLabel(field: ReconciliationRow['field']): string {
  return FIELD_LABELS[field] ?? field;
}

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
    if (!query.data) return;
    try {
      await applyMutation.mutateAsync({ submissionId, fieldsToApply: fields, expectedRevision: query.data.caseRevision });
      onClose();
    } catch {
      // Shown below; the rows reload against the current case.
    }
  }

  const applicableRows = rows.filter((r) => r.state !== 'review_only');
  const conflictRows = rows.filter((r) => r.state === 'conflict');
  const reviewOnlyRows = rows.filter((r) => r.state === 'review_only');
  const emptyEligibleFields = rows.filter((r) => r.eligibleForBulkApply).map((r) => r.field);

  return (
    <Modal open onClose={onClose} title="Review Submission">
      {query.isPending ? (
        <p>Loading…</p>
      ) : (
        <>
          {conflictRows.length > 0 && (
            <div className={styles.conflictBanner} role="status">
              <strong>This form disagrees with the case on: {conflictRows.map((r) => fieldLabel(r.field)).join(', ')}.</strong>{' '}
              The case keeps its current value unless you tick the field and apply the form&apos;s value.
            </div>
          )}
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
                  <td>{fieldLabel(row.field)}</td>
                  <td>{row.currentValue ?? '—'}</td>
                  <td className={row.state === 'conflict' ? styles.conflictValue : undefined}>
                    {row.incomingValue ?? '—'}
                    {row.state === 'conflict' && <span className={styles.conflictTag}>Differs from case</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {reviewOnlyRows.length > 0 && (
            <p className={styles.reviewOnly}>
              Also submitted (no matching SOLIS field): {reviewOnlyRows.map((r) => `${r.field}: ${r.incomingValue}`).join(', ')}
            </p>
          )}

          {applyMutation.error && (
            <div className="sx-form-banner sx-form-banner-error" role="alert">
              {applyMutation.error.message} The review has been reloaded with the case as it is now.
            </div>
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
