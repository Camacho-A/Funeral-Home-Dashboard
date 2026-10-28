import type { DataAdapterMode } from '@/lib/env';
import type { ActivityContext } from '../activityService';
import { recordExternalFormFieldsApplied, recordNokRelationshipNeedsReview } from '../activityService';
import { loadCaseOnServer } from '../serverCaseLoader';
import { updateCaseWithRetry, writeMockCase } from '../caseWriteService';
import { buildCaseFieldPatch } from '@/lib/wixCaseMapper';
import type { MappedSolisField } from '@/domain/externalForms/fieldMapping';
import { decideNokRelationshipAutofill, NOK_RELATIONSHIP_REVIEW_REASON, type NokRelationshipDecision } from '@/domain/externalForms/nokRelationshipAutofill';

/**
 * Next of Kin relationship from the Arrangement Forms (2026-10). Runs after
 * an Arrangement Form lands on a case — through the webhook (existing or
 * new case), Unmatched Forms (link or create), or a historical import — and
 * fills in the case's existing relationship field when that is safe (see
 * domain/externalForms/nokRelationshipAutofill.ts). Writes ONLY
 * `nextOfKinRelationship`, revision-safe, and only while it is still blank:
 * a staff choice made in the meantime is never overwritten. Never throws —
 * a failure leaves the case exactly as it was and the manual dropdown
 * working.
 */
export type NokRelationshipAutofillOutcome = NokRelationshipDecision['action'] | 'failed';

export async function applyArrangementNokRelationship(
  ctx: ActivityContext,
  caseId: string,
  submission: { id: string; mappedFields: string },
  dataAdapterMode: DataAdapterMode,
): Promise<NokRelationshipAutofillOutcome> {
  try {
    let mapped: Partial<Record<MappedSolisField, string>>;
    try {
      mapped = JSON.parse(submission.mappedFields) as Partial<Record<MappedSolisField, string>>;
    } catch {
      return 'none';
    }
    const case_ = await loadCaseOnServer(ctx.organizationId, caseId, dataAdapterMode);
    if (!case_ || case_.isDeleted) return 'none';

    const decision = decideNokRelationshipAutofill(case_, mapped);
    if (decision.action === 'review') {
      await recordNokRelationshipNeedsReview(
        ctx,
        caseId,
        submission.id,
        { submittedValue: decision.source, reason: NOK_RELATIONSHIP_REVIEW_REASON[decision.reason], formNextOfKinName: mapped.nextOfKinName ?? null },
        dataAdapterMode,
      ).catch((error) => console.error('Failed to record the NOK relationship review flag:', error instanceof Error ? error.message : error));
      return 'review';
    }
    if (decision.action !== 'apply') return decision.action;

    // Decide again against the row being written: if staff chose a
    // relationship (or changed the contact) since, nothing is written.
    let applied = false;
    if (dataAdapterMode === 'mock') {
      writeMockCase(ctx.organizationId, caseId, (current) => {
        const fresh = decideNokRelationshipAutofill(current, mapped);
        if (fresh.action !== 'apply') return current;
        applied = true;
        return { ...current, nextOfKinRelationship: fresh.relationship };
      });
    } else {
      const outcome = await updateCaseWithRetry(ctx.organizationId, caseId, (row) => {
        const fresh = decideNokRelationshipAutofill(row.case_, mapped);
        return fresh.action === 'apply' ? buildCaseFieldPatch(row.data, { nextOfKinRelationship: fresh.relationship }) : null;
      });
      if (outcome.result === 'failed' || outcome.result === 'conflict') throw new Error(`NOK relationship update for case ${caseId}: ${outcome.result}`);
      applied = outcome.result === 'applied';
    }
    if (!applied) return 'keep';

    await recordExternalFormFieldsApplied(ctx, caseId, submission.id, ['nextOfKinRelationship'], dataAdapterMode).catch((error) =>
      console.error('Failed to record the NOK relationship application:', error instanceof Error ? error.message : error),
    );
    return 'apply';
  } catch (error) {
    console.error(`Next of Kin relationship autofill for case ${caseId} failed:`, error instanceof Error ? error.message : error);
    return 'failed';
  }
}
