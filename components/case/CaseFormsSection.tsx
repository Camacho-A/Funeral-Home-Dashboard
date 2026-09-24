'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useCaseForms, useGenerateFormLink } from '@/hooks/useExternalForms';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatTimestamp } from '@/utils/format';
import { ReconciliationModal } from '@/components/externalForms/ReconciliationModal';
import { ImportHistoricalSubmissionModal } from '@/components/externalForms/ImportHistoricalSubmissionModal';
import type { CaseFormLinkStatus } from '@/types/caseFormLink';
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

export function CaseFormsSection({ caseId }: { caseId: string }) {
  const { organizationId } = useOrganization();
  const formsQuery = useCaseForms(organizationId, caseId);
  const generateLink = useGenerateFormLink(organizationId, caseId);
  const [copiedConfigId, setCopiedConfigId] = useState<string | null>(null);
  const [reviewingSubmissionId, setReviewingSubmissionId] = useState<string | null>(null);
  const [importingConfig, setImportingConfig] = useState<{ id: string; label: string } | null>(null);

  if (formsQuery.isPending) return null;
  const forms = formsQuery.data ?? [];
  if (forms.length === 0) return null;

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
          </div>
        </div>
      ))}

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
