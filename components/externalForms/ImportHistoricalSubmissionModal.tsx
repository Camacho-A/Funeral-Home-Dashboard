'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { usePreviewHistoricalImport, useImportHistoricalSubmission } from '@/hooks/useExternalForms';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatTimestamp } from '@/utils/format';
import styles from './ImportHistoricalSubmissionModal.module.css';

/**
 * Manors Jotform integration — historical-submission ingestion (2026-09).
 * Deliberately minimal: this case is already unambiguously selected (the
 * caller only ever renders this from inside one Case's own Forms
 * section), so the only new input needed is the Jotform submission id
 * itself. A safe-metadata-only preview (form label, submitted-at
 * timestamp, and whether the id actually belongs to the expected form)
 * must be confirmed before "Import" becomes available — this is the
 * "make it difficult to associate the wrong submission with the wrong
 * case" safeguard: a mismatched form is caught here, before any Solis
 * record is created, and no answer content is ever shown to make the
 * identification.
 */
export function ImportHistoricalSubmissionModal({
  caseId,
  formConfigId,
  formLabel,
  onClose,
}: {
  caseId: string;
  formConfigId: string;
  formLabel: string;
  onClose: () => void;
}) {
  const { organizationId } = useOrganization();
  const preview = usePreviewHistoricalImport(organizationId, caseId);
  const commit = useImportHistoricalSubmission(organizationId, caseId);
  const [submissionId, setSubmissionId] = useState('');
  const [result, setResult] = useState<{ alreadyImported: boolean } | null>(null);

  async function handleLookUp() {
    setResult(null);
    await preview.mutateAsync({ formConfigId, externalSubmissionId: submissionId.trim() });
  }

  async function handleImport() {
    const outcome = await commit.mutateAsync({ formConfigId, externalSubmissionId: submissionId.trim() });
    setResult(outcome);
  }

  const previewData = preview.data;
  const canImport = Boolean(previewData?.matchesConfig) && !result;

  return (
    <Modal open onClose={onClose} title="Import Existing Submission">
      <p className={styles.description}>
        Import a Jotform submission that was already collected for <strong>{formLabel}</strong> before this
        integration was activated. Paste its Jotform submission ID below.
      </p>

      <div className={styles.row}>
        <input
          type="text"
          className={styles.input}
          placeholder="Jotform submission ID"
          value={submissionId}
          onChange={(event) => {
            setSubmissionId(event.target.value);
            setResult(null);
          }}
          aria-label="Jotform submission ID"
        />
        <Button variant="secondary" onClick={handleLookUp} disabled={!submissionId.trim() || preview.isPending}>
          Look Up
        </Button>
      </div>

      {preview.isError && <p className={styles.error}>Could not retrieve that submission. Check the ID and try again.</p>}

      {previewData && (
        <div className={previewData.matchesConfig ? styles.previewOk : styles.previewWarning}>
          <div>Form: {previewData.formLabel}</div>
          <div>Submitted: {previewData.submittedAt ? formatTimestamp(previewData.submittedAt) : 'Unknown'}</div>
          {!previewData.matchesConfig && (
            <div className={styles.warningText}>
              This submission does not belong to {formLabel}. It cannot be imported here.
            </div>
          )}
        </div>
      )}

      {commit.isError && <p className={styles.error}>Import failed. Please try again.</p>}

      {result && (
        <p className={styles.success}>
          {result.alreadyImported ? 'This submission was already imported previously — no changes made.' : 'Submission imported successfully.'}
        </p>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button onClick={handleImport} disabled={!canImport || commit.isPending}>
          Import
        </Button>
      </div>
    </Modal>
  );
}
