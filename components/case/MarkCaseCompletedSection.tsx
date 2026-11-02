'use client';

import { useState } from 'react';
import type { Case } from '@/types/case';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { CaseCompletionError, useCompleteCase } from '@/hooks/useCompleteCase';
import { manualCompletionOffer } from '@/domain/cases/manualCompletionOffer';
import { CaseEditConflictBanner } from './CaseEditConflictBanner';
import textAreaFieldStyles from '@/components/ui/TextArea.module.css';
import styles from './MarkCaseCompletedSection.module.css';

/**
 * Service-specific completion (2026-10). The Case Detail "Mark completed"
 * action, for a case whose OWN frozen completion policy allows manual
 * completion (types/workflowTemplate.ts#WorkflowCompletionPolicy).
 *
 * Rendered only when domain/cases/manualCompletionOffer.ts says so: the
 * policy allows it, the viewer holds the policy's existing permission
 * (case.delete unless the workflow says case.update), and the case is
 * active and not already complete. Direct Cremation, Manors and every
 * case without a policy never allow it — nothing renders for them.
 *
 * Confirmation is an in-page panel, never a browser dialog: it says what
 * the policy requires, which requirements are still unmet, and asks for a
 * reason (required — recorded in the activity log). When the policy
 * requires the return of cremated remains and it is not recorded, the
 * confirm button stays disabled and says why: manual completion never
 * replaces that. The server re-decides everything
 * (POST /api/cases/[caseId]/complete); its refusal is shown in the panel,
 * and a revision conflict shows the shared CaseEditConflictBanner.
 */
export function MarkCaseCompletedSection({ caseId, case_ }: { caseId: string; case_: Case }) {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const completeCase = useCompleteCase(caseId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);

  const offer = manualCompletionOffer(case_, permissionsQuery.data?.permissions ?? null);

  const banner = completeCase.conflict && (
    <CaseEditConflictBanner
      message={completeCase.conflict.message}
      onRefresh={() => void completeCase.refreshAfterConflict()}
      onRetry={() => void completeCase.retryAfterConflict()}
    />
  );

  if (!offer) return banner || null;

  const reasonMissing = reason.trim() === '';
  // Outstanding requirements are already listed with their status above;
  // only the other reasons (stage, undefined requirements) repeat here.
  const otherReasons = offer.reasons.filter((line) => !line.startsWith('Outstanding:'));
  const canConfirm = !offer.blockedReason && !reasonMissing && !completeCase.isPending;

  function close() {
    setOpen(false);
    setReason('');
    setReasonTouched(false);
    completeCase.reset();
  }

  function confirm() {
    setReasonTouched(true);
    if (!canConfirm) return;
    completeCase.complete(reason.trim(), { onSuccess: () => close() });
  }

  return (
    <>
      {banner}
      {!open ? (
        <div className={styles.row}>
          <button type="button" className={styles.markButton} onClick={() => setOpen(true)}>
            Mark completed
          </button>
          <span className={styles.hint}>Finish this case by hand, with a reason. Recorded in the activity log.</span>
        </div>
      ) : (
        <section className={styles.panel} aria-label="Mark case completed">
          <div className={styles.panelTitle}>Mark this case completed?</div>

          <div className={styles.sectionLabel}>What this service requires</div>
          <ul className={styles.policyList}>
            {offer.policyLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {offer.requirements.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Requirements</div>
              <ul className={styles.requirementList}>
                {offer.requirements.map((requirement) => (
                  <li key={requirement.key} className={requirement.done ? styles.requirementDone : styles.requirementUnmet}>
                    <span aria-hidden="true">{requirement.done ? '✓' : '○'}</span> {requirement.label}
                    <span className="sr-only">{requirement.done ? ' — done' : ' — not yet met'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {otherReasons.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Not yet met</div>
              <ul className={styles.reasonList}>
                {otherReasons.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}

          {offer.policy.requiresRemainsReturn && (
            <p className={styles.note}>
              Marking a case completed stands in for checklist items only — it never replaces the return of cremated
              remains, which must be recorded first.
            </p>
          )}

          {offer.blockedReason && (
            <div className={styles.blocked} role="note">
              {offer.blockedReason}
            </div>
          )}

          <label className={styles.reasonLabel} htmlFor={`mark-completed-reason-${caseId}`}>
            Reason (required)
          </label>
          <textarea
            id={`mark-completed-reason-${caseId}`}
            className={textAreaFieldStyles.field}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setReasonTouched(true)}
            aria-invalid={reasonTouched && reasonMissing ? true : undefined}
            placeholder="e.g. Committal held; cemetery confirmation received by phone."
            disabled={completeCase.isPending}
          />
          {reasonTouched && reasonMissing && (
            <div className={styles.fieldError} role="alert">
              Give a reason for completing this case by hand.
            </div>
          )}

          {completeCase.error && (
            <div className="sx-form-banner sx-form-banner-error" role="alert">
              <span>
                {completeCase.error.message}
                {completeCase.error instanceof CaseCompletionError && completeCase.error.details.length > 0
                  ? ` ${completeCase.error.details.join(' ')}`
                  : ''}
              </span>
            </div>
          )}

          <div className={styles.footer}>
            <button type="button" className={styles.cancelButton} onClick={close} disabled={completeCase.isPending}>
              Cancel
            </button>
            <button type="button" className={styles.confirmButton} onClick={confirm} disabled={!canConfirm}>
              {completeCase.isPending ? 'Completing…' : 'Mark completed'}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
