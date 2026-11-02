import type { Case } from '../../types/case';
import type { ManualCompletionPermission, WorkflowCompletionPolicy } from '../../types/workflowTemplate';
import { describeCompletionPolicy, effectiveCompletionPolicy } from '../workflow/completionPolicy';
import {
  decideManualCompletion,
  evaluateCaseCompletion,
  manualCompletionPermission,
  type CompletionRequirement,
} from './completionEligibility';

/**
 * Service-specific completion (2026-10) — the Case Detail side. Pure
 * derivations the page's "Mark completed" action and the remains-return
 * controls read, so every rule stays the one in
 * domain/cases/completionEligibility.ts (never re-implemented in a
 * component).
 */

/**
 * Whether Case Detail shows cremated-remains return controls (return
 * method, family pickup / release, shipping, the cremains pickup section)
 * for this case. False only when the case's OWN frozen policy says no
 * remains are returned (burial / entombment). A case with no policy — every
 * Manors and pre-policy case — and every cremation policy keep them
 * exactly as before. Display only: stored values are never cleared.
 */
export function showsRemainsReturnControls(case_: Pick<Case, 'workflowSnapshot'> | null | undefined): boolean {
  if (!case_) return true;
  return effectiveCompletionPolicy(case_.workflowSnapshot).requiresRemainsReturn;
}

export type ManualCompletionOffer = {
  policy: WorkflowCompletionPolicy;
  permission: ManualCompletionPermission;
  /** Staff-facing description of what the policy requires. */
  policyLines: string[];
  requirements: CompletionRequirement[];
  /** The requirements not yet met (what manual completion stands in for). */
  unmet: CompletionRequirement[];
  /** Every reason the case is not complete yet (stage, undefined
      requirements, outstanding items) — from evaluateCaseCompletion. */
  reasons: string[];
  /** Why the server would refuse right now (other than a missing reason) —
      e.g. the return of remains is not recorded, or the case has not
      reached its last stages. Null when confirming is possible. */
  blockedReason: string | null;
};

/**
 * Whether to offer "Mark completed" at all, and what the confirmation
 * shows. Null — nothing rendered — unless the case's own policy allows
 * manual completion, the viewer holds that policy's permission, and the
 * case is active and not already complete. Direct Cremation, Manors and
 * every snapshot without a policy never allow it, so nothing new appears
 * for them.
 *
 * `permissions` null = not known yet (still loading / failed): not offered.
 */
export function manualCompletionOffer(case_: Case, permissions: readonly string[] | null | undefined): ManualCompletionOffer | null {
  if (!case_.workflowSnapshot || case_.isDeleted === true) return null;
  const evaluation = evaluateCaseCompletion(case_);
  const { policy } = evaluation;
  if (!policy.manualCompletion.allowed) return null;
  const permission = manualCompletionPermission(policy);
  if (!permissions || !permissions.includes(permission)) return null;
  if (evaluation.eligible) return null;

  // The same decision the route makes, with a placeholder reason so only
  // the case-state refusals (stage, remains return) surface here — the
  // reason itself is checked by the form.
  const decision = decideManualCompletion(case_, {
    actorHasPermission: true,
    actorIdentityId: 'preview',
    reason: 'preview',
    now: new Date(0).toISOString(),
  });

  return {
    policy,
    permission,
    policyLines: describeCompletionPolicy(policy),
    requirements: evaluation.requirements,
    unmet: evaluation.requirements.filter((requirement) => !requirement.done),
    reasons: evaluation.reasons,
    blockedReason: decision.allowed ? null : decision.error,
  };
}
