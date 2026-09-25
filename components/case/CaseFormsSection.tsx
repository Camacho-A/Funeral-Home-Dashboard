'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useCaseForms, useGenerateFormLink, useRetryFormPdf } from '@/hooks/useExternalForms';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatTimestamp } from '@/utils/format';
import { ReconciliationModal } from '@/components/externalForms/ReconciliationModal';
import { ImportHistoricalSubmissionModal } from '@/components/externalForms/ImportHistoricalSubmissionModal';
import type { CaseFormLinkStatus } from '@/types/caseFormLink';
import type { CaseFormRow } from '@/lib/externalFormsClient';
import styles from './CaseFormsSection.module.css';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Case
 * Detail's "Forms" section — one row per `ExternalFormConfig` the
 * organization has configured, entirely provider/form-neutral (no
 * Manors-specific form id appears here; the rows themselves come from
 * `GET /api/cases/[caseId]/forms`). Only ever shows states Solis can
 * actually know — see that route's own comment on why no "In Progress"
 * status exists.
 *
 * "Send Form" (emailing the link) is deliberately NOT implemented this
 * pass — the family-facing Vital Statistics form offers "Copy Link"
 * instead, since this integration did not audit whether the existing
 * notification/email mechanism can safely dispatch an ad hoc external
 * link with a knowable delivery outcome (see this integration's own
 * report). Arrangement Forms (staff-audience) opens directly, since the
 * person acting and the person filling it out are the same staff member.
 */

const STATUS_LABEL: Record<CaseFormLinkStatus, string> = {
  not_sent: 'Not Sent',
  sent: 'Sent',
  received: 'Received',
  reviewed: 'Reviewed',
};

function statusBadgeVariant(status: CaseFormLinkStatus): 'neutral' | 'brand' | 'success' {
  if (status === 'received') return 'brand';
  if (status === 'reviewed') return 'success';
  return 'neutral';
}

/** Case repair UI (2026-09) — "Retry Jotform PDF" only ever appears for a
    row that is actually linked to a submission and does NOT already have
    a successfully stored document. Never shown once `documentId` is set
    (already stored — nothing to retry, and re-clicking must never be
    possible to trigger, not just discouraged), and never shown for a
    submission whose PDF preservation is `not_applicable` for its form
    type. The underlying retry-pdf endpoint/service is independently
    idempotent regardless (see externalFormPdfService.ts), so this is a
    UX guard, not the only thing preventing a duplicate. */
function canRetryPdf(row: CaseFormRow): boolean {
  return Boolean(row.submissionId) && !row.documentId && row.pdfStatus !== 'not_applicable';
}

export function CaseFormsSection({ caseId }: { caseId: string }) {
  const { organizationId } = useOrganization();
  const formsQuery = useCaseForms(organizationId, caseId);
  const generateLink = useGenerateFormLink(organizationId, caseId);
  const retryPdf = useRetryFormPdf(organizationId, caseId);
  const [copiedConfigId, setCopiedConfigId] = useState<string | null>(null);
  const [reviewingSubmissionId, setReviewingSubmissionId] = useState<string | null>(null);
  const [importingConfig, setImportingConfig] = useState<{ id: string; label: string } | null>(null);
  const [retryConfirming, setRetryConfirming] = useState<{ submissionId: string; configId: string; label: string } | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<{ configId: string; message: string; isError: boolean } | null>(null);

  if (formsQuery.isPending) return null;
  const forms = formsQuery.data ?? [];
  if (forms.length === 0) return null;

  async function handleRetryPdf() {
    if (!retryConfirming) return;
    const { submissionId, configId } = retryConfirming;
    setRetryConfirming(null);
    try {
      const result = await retryPdf.mutateAsync(submissionId);
      setRetryFeedback({
        configId,
        message: result.pdf.outcome === 'failed' ? 'Retry failed — the document could not be retrieved. You can try again.' : 'Document retrieved successfully.',
        isError: result.pdf.outcome === 'failed',
      });
    } catch (error) {
      setRetryFeedback({ configId, message: error instanceof Error ? error.message : 'Retry failed. Please try again.', isError: true });
    }
  }

  async function handleGetLink(formConfigId: string, audience: 'family' | 'staff') {
    const { prefillUrl } = await generateLink.mutateAsync(formConfigId);
    if (audience === 'staff') {
      window.open(prefillUrl, '_blank', 'noopener,noreferrer');
    } else {
      await navigator.clipboard.writeText(prefillUrl);
      setCopiedConfigId(formConfigId);
      setTimeout(() => setCopiedConfigId((current) => (current === formConfigId ? null : current)), 2500);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.title}>Forms</div>
      {forms.map((row) => (
        <div key={row.config.id} className={styles.row}>
          <div className={styles.rowMain}>
          <div>
            <div className={styles.label}>{row.config.label}</div>
            {row.sentAt && <div className={styles.meta}>Sent {formatTimestamp(row.sentAt)}</div>}
          </div>
          <div className={styles.actions}>
            <Badge variant={statusBadgeVariant(row.status)}>{STATUS_LABEL[row.status]}</Badge>
            {(row.status === 'not_sent' || row.status === 'sent') && (
              <Button
                variant="secondary"
                disabled={generateLink.isPending}
                onClick={() => handleGetLink(row.config.id, row.config.audience)}
              >
                {copiedConfigId === row.config.id
                  ? 'Copied!'
                  : row.config.audience === 'staff'
                    ? 'Open Form'
                    : row.status === 'sent'
                      ? 'Regenerate Link'
                      : 'Copy Link'}
              </Button>
            )}
            {(row.status === 'received' || row.status === 'reviewed') && row.submissionId && (
              <Button variant="secondary" onClick={() => setReviewingSubmissionId(row.submissionId)}>
                {row.status === 'received' ? 'Review Submission' : 'View Submission'}
              </Button>
            )}
            {(row.status === 'not_sent' || row.status === 'sent') && (
              <Button variant="ghost" onClick={() => setImportingConfig({ id: row.config.id, label: row.config.label })}>
                Import Existing Submission
              </Button>
            )}
            {canRetryPdf(row) && (
              <Button
                variant="ghost"
                disabled={retryPdf.isPending}
                onClick={() => setRetryConfirming({ submissionId: row.submissionId as string, configId: row.config.id, label: row.config.label })}
              >
                Retry Jotform PDF
              </Button>
            )}
          </div>
          </div>
          {retryFeedback && retryFeedback.configId === row.config.id && (
            <div className={retryFeedback.isError ? styles.retryError : styles.retrySuccess}>{retryFeedback.message}</div>
          )}
        </div>
      ))}

      {retryConfirming && (
        <Modal open onClose={() => setRetryConfirming(null)} title="Retry Jotform PDF">
          <p>
            Retry retrieving the exact {retryConfirming.label} Smart PDF from Jotform for this submission? This does
            not change any case data, does not create a case, and does not affect case numbering.
          </p>
          <div className={styles.confirmActions}>
            <Button variant="secondary" onClick={() => setRetryConfirming(null)} disabled={retryPdf.isPending}>
              Cancel
            </Button>
            <Button onClick={handleRetryPdf} disabled={retryPdf.isPending}>
              {retryPdf.isPending ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        </Modal>
      )}

      {reviewingSubmissionId && (
        <ReconciliationModal
          submissionId={reviewingSubmissionId}
          caseId={caseId}
          onClose={() => setReviewingSubmissionId(null)}
        />
      )}

      {importingConfig && (
        <ImportHistoricalSubmissionModal
          caseId={caseId}
          formConfigId={importingConfig.id}
          formLabel={importingConfig.label}
          onClose={() => setImportingConfig(null)}
        />
      )}
    </div>
  );
}
