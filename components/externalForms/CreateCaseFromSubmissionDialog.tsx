'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useCreateCasePreview, useCreateCaseFromSubmission } from '@/hooks/useExternalForms';
import { formatTimestamp } from '@/utils/format';
import styles from './CreateCaseFromSubmissionDialog.module.css';

/**
 * Unmatched Forms → Create Case (2026-10).
 *
 * Everything shown here comes from the server's own preview, re-verified
 * against Jotform at the moment the dialog opens — not from the cached
 * `mappedFields` on the row, and not derived on the client. So what staff
 * read is exactly what the creation will act on.
 *
 * Duplicate candidates are shown BEFORE the confirm button does anything
 * destructive, and acknowledging them is a separate, deliberate act: the
 * primary button will not create a case while unreviewed candidates
 * exist. The guard exists to stop silent duplication, not to overrule a
 * person who has looked at the candidates and decided this is a
 * different death.
 */
export function CreateCaseFromSubmissionDialog({
  organizationId,
  submissionId,
  onClose,
}: {
  organizationId: string;
  submissionId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const preview = useCreateCasePreview(organizationId, submissionId);
  const createCase = useCreateCaseFromSubmission(organizationId);
  const [acknowledged, setAcknowledged] = useState(false);

  const open = submissionId !== null;
  const candidates = preview.data?.duplicateCandidates ?? [];
  const blockedByDuplicates = candidates.length > 0 && !acknowledged;

  function handleClose() {
    setAcknowledged(false);
    createCase.reset();
    onClose();
  }

  function handleCreate() {
    if (!submissionId) return;
    createCase.mutate(
      { submissionId, acknowledgedDuplicates: acknowledged },
      {
        onSuccess: ({ case: created }) => {
          handleClose();
          // Open the case that was just created — the point of the
          // action is to get staff working on it, not back to a list.
          router.push(`/cases/${created.id}`);
        },
      },
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create case from this submission?">
      {preview.isPending && <p className={styles.body}>Checking this submission…</p>}

      {preview.isError && (
        <p className={styles.error} role="alert">
          {preview.error instanceof Error ? preview.error.message : 'This submission cannot create a case.'}
        </p>
      )}

      {preview.data && (
        <>
          <p className={styles.body}>
            Create a new SOLIS case using the information from this JotForm submission?
          </p>

          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>Deceased</dt>
              <dd>{preview.data.decedentName ?? <span className={styles.absent}>Not provided</span>}</dd>
            </div>
            {preview.data.dateOfDeath && (
              <div className={styles.fact}>
                <dt>Date of death</dt>
                <dd>{preview.data.dateOfDeath}</dd>
              </div>
            )}
            <div className={styles.fact}>
              <dt>Form</dt>
              <dd>{preview.data.formLabel}</dd>
            </div>
            <div className={styles.fact}>
              <dt>Submitted</dt>
              <dd>{formatTimestamp(preview.data.receivedAt)}</dd>
            </div>
          </dl>

          {candidates.length > 0 && (
            <div className={styles.duplicateWarning} role="note">
              <div className={styles.duplicateTitle}>
                {candidates.length === 1 ? 'A similar case already exists' : 'Similar cases already exist'}
              </div>
              <ul className={styles.duplicateList}>
                {candidates.map((candidate) => (
                  <li key={candidate.caseId || candidate.caseNumber}>
                    <strong>{candidate.caseNumber}</strong> — {candidate.decedentName}
                    {candidate.matchedOn.length > 0 && (
                      <span className={styles.matchedOn}> (same {candidate.matchedOn.join(' and ')})</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className={styles.duplicateHelp}>
                If one of these is the same person, close this and use <strong>Search existing SOLIS case</strong> to
                link the submission instead — that keeps everything on one case.
              </p>
              <label className={styles.acknowledge}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I have checked these and this is a different person.
              </label>
            </div>
          )}

          {createCase.isError && (
            <p className={styles.error} role="alert">
              {createCase.error instanceof Error ? createCase.error.message : 'Could not create the case.'}
            </p>
          )}
        </>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={handleClose} disabled={createCase.isPending}>
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          disabled={!preview.data || blockedByDuplicates || createCase.isPending}
        >
          {createCase.isPending ? 'Creating…' : 'Create Case'}
        </Button>
      </div>
    </Modal>
  );
}
