import type { DataAdapterMode } from '@/lib/env';
import type { ActivityContext } from '../activityService';
import type { Case } from '@/types/case';
import { checklistItemsForEvent } from '@/domain/sla/slaMilestones';
import { completeChecklistItemsAutomatically } from '../automaticChecklistCompletion';
import { reconcileCaseWorkflow } from '../workflowReconciliationService';
import { syncExpectedPickupForCase } from '../cremainsPickupService';
import { getOrganization } from '../organizationProvisioningService';
import { loadCaseOnServer } from '../serverCaseLoader';
import { CrematoryError } from './crematoryPackageService';

/**
 * Send to Crematory — the sent case's checklist (2026-10).
 *
 * Once SOLIS has sent a case's Crematory Package and Outlook accepted the
 * email (`lastSubmission.status === 'submitted'` — what SOLIS calls sent),
 * Workflow 3's "Permit sent to crematory" and "Authorization of release
 * sent to crematory" are completed automatically, so staff never tick them
 * by hand after a send.
 *
 *   - The items are found by their stable keys (stage 3, items 0 and 1),
 *     guarded by the labels in the case's own snapshot — the same mapping
 *     the SLA panel uses (`checklistItemsForEvent(…, 'sent_to_crematory')`).
 *     A template without both items is left alone.
 *   - Only for a case whose send record says submitted, re-checked on the
 *     case as it is at write time. Never for a failed, cancelled, uncertain
 *     or in-progress send.
 *   - One revision-conditioned write for both items; each carries the send
 *     (submission id), the time and the staff member who sent it.
 *   - Never on an archived case, never over a staff tick. A staff reopen
 *     made before the send is superseded by the send.
 *   - Then exactly what a staff tick triggers: workflow reconciliation
 *     (only ever moves a case forward) and the expected-pickup sync.
 *
 * Idempotent: running it again changes nothing. Nothing here sends, and
 * the checklist never decides whether a case can be sent — the send record
 * does (crematorySendService.ts).
 */
export type SentChecklistOutcome = 'completed' | 'unchanged' | 'not_applicable';

export const CREMATORY_SENT_TRIGGER_EVENT = 'crematory.package_submitted';

export function crematorySentChecklistItems(case_: Pick<Case, 'workflowSnapshot'>) {
  return checklistItemsForEvent(case_, 'sent_to_crematory');
}

const wasSentBySolis = (case_: Case) => case_.crematory?.lastSubmission?.status === 'submitted';

export async function completeCrematorySentChecklist(
  ctx: ActivityContext,
  caseId: string,
  /** The send that proves it — recorded on each item. */
  submissionId: string,
  mode: DataAdapterMode,
): Promise<SentChecklistOutcome> {
  const { outcome } = await completeChecklistItemsAutomatically(
    ctx.organizationId,
    caseId,
    { source: 'workflow_event', eventType: CREMATORY_SENT_TRIGGER_EVENT, eventId: submissionId },
    (case_) => crematorySentChecklistItems(case_),
    mode,
    {
      // The case's own send record, as it is at write time — this send, submitted.
      decideApplicable: (case_) => wasSentBySolis(case_) && case_.crematory!.lastSubmission!.submissionId === submissionId,
      actor: ctx.actorIdentityId ? { identityId: ctx.actorIdentityId, roleKey: ctx.actorRoleKey } : null,
      overrideEarlierReopen: true,
      correlationId: ctx.correlationId,
    },
  );
  if (outcome !== 'completed') return outcome;

  // Exactly what a staff tick triggers. Best-effort: the items are saved.
  try {
    await reconcileCaseWorkflow(ctx.organizationId, caseId, mode);
  } catch (error) {
    console.error('Failed to reconcile workflow after Send to Crematory:', error instanceof Error ? error.message : error);
  }
  try {
    const case_ = await loadCaseOnServer(ctx.organizationId, caseId, mode);
    const organization = await getOrganization(ctx.organizationId, mode);
    if (case_) {
      await syncExpectedPickupForCase(
        {
          case_,
          organization: organization ? { id: organization.id, timezone: organization.timezone, cremainsPickupSettings: organization.cremainsPickupSettings } : null,
          paperworkCompletedAt: new Date().toISOString(),
        },
        ctx,
        mode,
      );
    }
  } catch (error) {
    console.error('Failed to sync the expected cremains pickup after Send to Crematory:', error instanceof Error ? error.message : error);
  }
  return 'completed';
}

/**
 * Staff retry (2026-10) after the checklist could not be saved when the
 * case was sent: completes the two items from the case's own send record.
 * Never sends. Refused for a case SOLIS has not sent.
 */
export async function retryCrematorySentChecklist(ctx: ActivityContext, caseId: string, mode: DataAdapterMode): Promise<SentChecklistOutcome> {
  const case_ = await loadCaseOnServer(ctx.organizationId, caseId, mode);
  if (!case_ || case_.organizationId !== ctx.organizationId) throw new CrematoryError('Case not found.', 404);
  if (case_.isDeleted) throw new CrematoryError('This case is archived and read-only.', 409);
  if (!wasSentBySolis(case_)) throw new CrematoryError('This case has not been sent to the crematory through SOLIS, so its checklist is not completed from a send.', 409);
  return completeCrematorySentChecklist(ctx, caseId, case_.crematory!.lastSubmission!.submissionId, mode);
}
