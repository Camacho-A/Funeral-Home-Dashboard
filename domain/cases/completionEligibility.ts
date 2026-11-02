import type { Case, CaseManualCompletion } from '../../types/case';
import type { CompletionItemRef, ManualCompletionPermission, WorkflowCompletionPolicy } from '../../types/workflowTemplate';
import { findStageByDisplayStage, findStageByRawStage, lastDisplayStage } from '../workflow/resolveStages';
import { resolveChecklist } from '../workflow/resolveChecklist';
import { DEFAULT_MANUAL_COMPLETION_PERMISSION, effectiveCompletionPolicy } from '../workflow/completionPolicy';
import { isTerminalReturnRequirementComplete, terminalReturnRequirementLabel } from './returnMethod';

/**
 * Service-specific completion (2026-10). THE answer to "is this case
 * finished, and if not, what is still outstanding?" — judged by the
 * completion policy frozen on the case's OWN workflow snapshot
 * (types/workflowTemplate.ts#WorkflowCompletionPolicy), never by a
 * hardcoded cremation assumption. Pure; every consumer reads it:
 *   - domain/cases/workflowCompletion.ts (isCaseWorkflowComplete /
 *     becameComplete — the archiver and the completion announcement),
 *   - domain/cases/viewModel.ts (whether the stage reads "Completed",
 *     the row status, the terminal item),
 *   - reports, through the view model's displayStage
 *     (domain/reports/calculations.ts#reportStageRef).
 *
 * A case is COMPLETE when it sits on its workflow's final stage and
 *   - automatically: every requirement of its policy is met — the return
 *     of cremated remains when the policy requires it (pickup released /
 *     shipment confirmed delivered, domain/cases/returnMethod.ts), and
 *     every required final item done; or
 *   - manually: staff recorded a manual completion
 *     (Case.manualCompletion), the policy allows it, and — when the
 *     policy requires it — the remains were returned. Manual completion
 *     stands in for checklist items, never for the return of remains.
 *
 * A snapshot with no policy is judged by today's rule (remains return
 * only) — LEGACY_COMPLETION_POLICY — so this reproduces the old
 * `isTerminalReturnRequirementComplete` gate exactly for every existing
 * case (proven by completionEligibility.test.ts's equivalence suite).
 */

/** The case fields completion can depend on. The structural ones are
    required (as the old signature required them); the rest are only read
    by a policy with required final items or manual completion, and are
    always present on a real Case. */
export type CompletionCase = Pick<Case, 'rawStage' | 'workflowSnapshot' | 'returnMethod' | 'pickupStatus' | 'shippingDeliveryStatus'> &
  Partial<Case>;

export type CompletionRequirement = {
  /** 'remains_return' or "{displayStage}:{index}" of a required item. */
  key: string;
  label: string;
  done: boolean;
};

export type CaseCompletionEvaluation = {
  /** The policy applied — the snapshot's own, else today's rule. */
  policy: WorkflowCompletionPolicy;
  /** True when the snapshot carries no policy (today's rule applied). */
  isLegacyPolicy: boolean;
  onFinalStage: boolean;
  /** Every automatic requirement met (regardless of stage). */
  requirementsMet: boolean;
  /** Complete — the one signal everything else keys off. */
  eligible: boolean;
  mode: 'automatic' | 'manual' | null;
  requirements: CompletionRequirement[];
  /** Staff-facing reasons the case is not complete; empty when it is. */
  reasons: string[];
};

/** The required items' done state, resolved exactly as the checklist
    shows them on the stage they belong to (never as a "past stage", which
    would read every item done). */
function requiredItemStatus(case_: CompletionCase, ref: CompletionItemRef): CompletionRequirement {
  const snapshot = case_.workflowSnapshot!;
  const stage = findStageByDisplayStage(snapshot, ref.displayStage);
  const safeCase = { checklistState: {}, fieldValues: {}, ...case_ } as Case;
  const resolved = stage ? resolveChecklist(stage.checklist.items, ref.displayStage, safeCase, { isPastStage: false }) : [];
  const item = resolved.find((entry) => entry.index === ref.index);
  return { key: `${ref.displayStage}:${ref.index}`, label: ref.label, done: item?.done === true };
}

export function evaluateCaseCompletion(case_: CompletionCase): CaseCompletionEvaluation {
  const snapshot = case_.workflowSnapshot;
  const policy = effectiveCompletionPolicy(snapshot);
  const isLegacyPolicy = !snapshot?.completionPolicy;
  if (!snapshot) {
    // Without its own template there is no "final stage" to be at —
    // unchanged from the rule this replaces.
    return { policy, isLegacyPolicy, onFinalStage: false, requirementsMet: false, eligible: false, mode: null, requirements: [], reasons: ['This case has no workflow.'] };
  }

  const displayStage = findStageByRawStage(snapshot, case_.rawStage)?.displayStage;
  const onFinalStage = displayStage !== undefined && displayStage === lastDisplayStage(snapshot);

  const requirements: CompletionRequirement[] = [];
  const remainsReturned = isTerminalReturnRequirementComplete(case_);
  if (policy.requiresRemainsReturn) {
    requirements.push({ key: 'remains_return', label: terminalReturnRequirementLabel(case_.returnMethod), done: remainsReturned });
  }
  for (const ref of policy.requiredFinalItems) requirements.push(requiredItemStatus(case_, ref));
  // A checklist-decided policy with nothing to check is "not defined yet":
  // it must never complete on nothing.
  const undefinedRequirements = policy.kind === 'final_items' && policy.requiredFinalItems.length === 0;
  const requirementsMet = !undefinedRequirements && requirements.every((requirement) => requirement.done);

  const manualRecorded = Boolean(case_.manualCompletion) && policy.manualCompletion.allowed;
  const manualSatisfied = manualRecorded && (!policy.requiresRemainsReturn || remainsReturned);

  const automatic = onFinalStage && requirementsMet;
  const manual = !automatic && onFinalStage && manualSatisfied;
  const eligible = automatic || manual;

  const reasons: string[] = [];
  if (!eligible) {
    if (!onFinalStage) reasons.push('The case has not reached its final stage.');
    if (undefinedRequirements) reasons.push('The checklist items that complete this service have not been defined.');
    for (const requirement of requirements) if (!requirement.done) reasons.push(`Outstanding: ${requirement.label}`);
  }

  return { policy, isLegacyPolicy, onFinalStage, requirementsMet, eligible, mode: automatic ? 'automatic' : manual ? 'manual' : null, requirements, reasons };
}

/** Whether a case is complete. */
export function isCaseCompletionEligible(case_: CompletionCase): boolean {
  return evaluateCaseCompletion(case_).eligible;
}

// ---------------------------------------------------------------------------
// Transitions, archiving
// ---------------------------------------------------------------------------

export type CompletionTransition = {
  /** The case was not complete before and is now. */
  becameComplete: boolean;
  mode: 'automatic' | 'manual' | null;
  /** Archive it now — only on the transition, and only when its policy
      archives on completion (today's behaviour for every policy that
      does not say otherwise). */
  archive: boolean;
  policy: WorkflowCompletionPolicy;
};

/**
 * The completion transition between two states of one case — what the
 * case PATCH route (and the manual completion route) act on. Keyed off the
 * TRANSITION, never the state, for the reasons
 * domain/cases/workflowCompletion.ts#becameComplete gives (no backfill,
 * restore-safe, idempotent). `after` should be the case as finally
 * persisted — after workflow reconciliation — so a completion reached by
 * reconciliation advancing the case onto its final stage is seen too.
 */
export function completionTransition(before: CompletionCase, after: CompletionCase): CompletionTransition {
  const prior = evaluateCaseCompletion(before);
  const next = evaluateCaseCompletion(after);
  const becameComplete = !prior.eligible && next.eligible;
  return {
    becameComplete,
    mode: becameComplete ? next.mode : null,
    archive: becameComplete && next.policy.archiveEligibility === 'on_completion',
    policy: next.policy,
  };
}

/** Whether completing this case archives it (policy-driven; true under
    today's rule). */
export function archivesOnCompletion(case_: Pick<Case, 'workflowSnapshot'>): boolean {
  return effectiveCompletionPolicy(case_.workflowSnapshot).archiveEligibility === 'on_completion';
}

// ---------------------------------------------------------------------------
// Manual completion — the decision behind POST /api/cases/[caseId]/complete
// ---------------------------------------------------------------------------

export type ManualCompletionDecision =
  | { allowed: true; patch: Pick<Case, 'rawStage' | 'daysWaitingInStage'> & { manualCompletion: CaseManualCompletion }; permission: ManualCompletionPermission }
  | { allowed: false; status: 403 | 409 | 422; error: string; reasons?: string[] };

/** The permission a policy's manual completion requires. */
export function manualCompletionPermission(policy: WorkflowCompletionPolicy): ManualCompletionPermission {
  return policy.manualCompletion.permission ?? DEFAULT_MANUAL_COMPLETION_PERMISSION;
}

/**
 * Whether staff may complete this case by hand now, and the patch that
 * does it. Rules, in order:
 *   - the case is active (an archived case is read-only);
 *   - its frozen policy allows manual completion (422 — a policy
 *     decision, not a permission problem);
 *   - the actor holds the policy's permission (403);
 *   - it is not already complete (409);
 *   - it is on its final stage, or the working stage right before it —
 *     manual completion finishes a case, it never skips its work (422);
 *   - the return of remains, when the policy requires it, is recorded —
 *     manual completion never replaces it (422);
 *   - a reason is given (422).
 * The patch moves the case onto its final stage and records who, when and
 * why; nothing else about the case changes.
 */
export function decideManualCompletion(
  case_: CompletionCase,
  input: { actorHasPermission: boolean; actorIdentityId: string; actorName?: string | null; reason: unknown; now: string },
): ManualCompletionDecision {
  if (case_.isDeleted) return { allowed: false, status: 409, error: 'This case is archived — restore it before completing it.' };
  const snapshot = case_.workflowSnapshot;
  if (!snapshot) return { allowed: false, status: 422, error: 'This case has no workflow, so it cannot be completed.' };
  const evaluation = evaluateCaseCompletion(case_);
  const policy = evaluation.policy;
  if (!policy.manualCompletion.allowed) {
    return { allowed: false, status: 422, error: 'This case’s workflow does not allow manual completion.' };
  }
  if (!input.actorHasPermission) return { allowed: false, status: 403, error: 'Not authorized.' };
  if (evaluation.eligible) return { allowed: false, status: 409, error: 'This case is already completed.' };

  const last = lastDisplayStage(snapshot);
  const displayStage = findStageByRawStage(snapshot, case_.rawStage)?.displayStage ?? -1;
  if (displayStage < last - 1) {
    return {
      allowed: false,
      status: 422,
      error: 'Only a case on its final stage, or the stage just before it, can be completed by hand.',
      reasons: evaluation.reasons,
    };
  }
  if (policy.requiresRemainsReturn && !isTerminalReturnRequirementComplete(case_)) {
    return {
      allowed: false,
      status: 422,
      error: 'The return of cremated remains must be recorded before this case can be completed.',
      reasons: evaluation.reasons,
    };
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) return { allowed: false, status: 422, error: 'Give a reason for completing this case by hand.' };

  const finalRawStage = Math.max(...snapshot.stages.filter((stage) => stage.displayStage === last).map((stage) => stage.rawStage));
  return {
    allowed: true,
    permission: manualCompletionPermission(policy),
    patch: {
      rawStage: finalRawStage,
      daysWaitingInStage: finalRawStage === case_.rawStage ? (case_.daysWaitingInStage ?? 0) : 0,
      manualCompletion: {
        completedAt: input.now,
        completedBy: input.actorIdentityId,
        ...(input.actorName ? { completedByName: input.actorName } : {}),
        reason,
      },
    },
  };
}
