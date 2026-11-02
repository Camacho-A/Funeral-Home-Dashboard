import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { currentActorDisplayName } from '@/lib/auth/currentActorDisplayName';
import { canDeleteCase, canEditCase } from '@/services/authorizationPolicyService';
import { recordCaseArchiveChanged, recordCaseCompleted } from '@/services/activityService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { getDataAdapterMode } from '@/lib/env';
import { completionTransition, decideManualCompletion, evaluateCaseCompletion, manualCompletionPermission } from '@/domain/cases/completionEligibility';
import { effectiveCompletionPolicy } from '@/domain/workflow/completionPolicy';
import { buildCaseFieldPatch, caseRevision } from '@/lib/wixCaseMapper';
import { loadCaseRow, updateCaseWithRetry, type LoadedCaseRow } from '@/services/caseWriteService';
import {
  CASE_REVISION_CONFLICT_MESSAGE,
  CASE_REVISION_CONFLICT_REASON,
  CASE_REVISION_REQUIRED_MESSAGE,
  CASE_REVISION_REQUIRED_REASON,
  parseExpectedRevisionValue,
} from '@/domain/cases/caseRevisionConflict';
import type { Case } from '@/types/case';

/**
 * Service-specific completion (2026-10). The explicit staff "Mark
 * completed" action for a case whose FROZEN completion policy allows
 * manual completion (types/workflowTemplate.ts#WorkflowCompletionPolicy).
 * Body: `{ organizationId, reason }`.
 *
 * Every rule is the pure decision in
 * domain/cases/completionEligibility.ts#decideManualCompletion:
 *   - the policy allows it (422 otherwise — Direct Cremation, Manors and
 *     every snapshot without a policy never do);
 *   - the caller holds the policy's EXISTING permission — `case.delete`
 *     by default, or `case.update` if the workflow says so (403); no new
 *     permission is invented;
 *   - the case is active, on its final stage or the stage just before it,
 *     not already complete (409), and — when the policy requires it — its
 *     cremated remains were returned: manual completion never replaces
 *     that;
 *   - a reason is given.
 * On success the case moves onto its final stage with
 * `Case.manualCompletion` recorded (who, when, why), and a `case.completed`
 * activity event records the policy, the actor and `mode: 'manual'`.
 * When the policy archives on completion (today's behaviour), the case is
 * then archived exactly as an automatic completion would archive it —
 * attributed to SOLIS, recorded as `case.archived`.
 *
 * Wix mode (case concurrency, 2026-10): the write is ONE field-scoped
 * conditional patch through services/caseWriteService.ts — `currentStage`,
 * `daysWaitingInStage`, `manualCompletion` and, when the policy archives,
 * `isArchived`/`archivedAt`, plus the revision — conditioned on the
 * organization, the case and the revision it was decided from. If anything
 * else writes the case in between, the decision is re-made from a fresh
 * read (so a case someone else just completed answers 409 "already
 * completed", never a second completion). `expectedRevision` (REQUIRED
 * since Phase 5A.1 — 428 without it) in
 * the body pins it to the version staff were looking at (409 otherwise).
 * Another organization's case is 404.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const b = (body ?? {}) as { organizationId?: unknown; reason?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  const dataAdapterMode = getDataAdapterMode();
  // Phase 5A.1: REQUIRED — the revision of the case staff were looking at
  // when they chose to complete it. Missing → 428, nothing written.
  const parsedRevision = parseExpectedRevisionValue((b as { expectedRevision?: unknown }).expectedRevision);
  if (parsedRevision === 'invalid') {
    return NextResponse.json({ error: 'expectedRevision must be a non-negative integer.' }, { status: 400 });
  }
  if (parsedRevision === undefined) {
    return NextResponse.json({ error: CASE_REVISION_REQUIRED_MESSAGE, reason: CASE_REVISION_REQUIRED_REASON }, { status: 428 });
  }
  const expectedRevision: number | undefined = parsedRevision;

  let loadedRow: LoadedCaseRow | null = null;
  let existing: Case;
  if (dataAdapterMode === 'mock') {
    const found = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId);
    if (!found) return NextResponse.json({ error: `Case ${caseId} not found for this organization` }, { status: 404 });
    existing = found;
  } else {
    try {
      loadedRow = await loadCaseRow(organizationId, caseId);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error connecting to Wix.' }, { status: 503 });
    }
    if (!loadedRow) return NextResponse.json({ error: `Case ${caseId} not found for this organization` }, { status: 404 });
    existing = loadedRow.case_;
  }
  if (expectedRevision !== undefined && caseRevision(existing) !== expectedRevision) {
    return NextResponse.json({ error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: existing }, { status: 409 });
  }

  const policy = effectiveCompletionPolicy(existing.workflowSnapshot);
  const permissionParams = { identityId: userId, organizationId, roleKey: role };
  const actorHasPermission =
    manualCompletionPermission(policy) === 'case.update'
      ? await canEditCase(permissionParams, dataAdapterMode)
      : await canDeleteCase(permissionParams, dataAdapterMode);

  const decision = decideManualCompletion(existing, {
    actorHasPermission,
    actorIdentityId: userId,
    actorName: await currentActorDisplayName(userId),
    reason: b.reason,
    now: new Date().toISOString(),
  });
  if (!decision.allowed) {
    return NextResponse.json({ error: decision.error, ...(decision.reasons ? { details: decision.reasons } : {}) }, { status: decision.status });
  }

  let updated: Case = { ...existing, ...decision.patch };
  let evaluation = evaluateCaseCompletion(updated);
  if (!evaluation.eligible) {
    // Defensive: the decision and the evaluator share one rule set, so
    // this cannot happen — never persist a "completion" that would not read
    // as one.
    return NextResponse.json({ error: 'This case could not be completed.', details: evaluation.reasons }, { status: 422 });
  }
  let transition = completionTransition(existing, updated);
  let completion = decision.patch.manualCompletion;

  if (dataAdapterMode === 'mock') {
    // The permission and actor lookups above awaited: re-check the store
    // right before writing (nothing awaits between this check and the
    // write), so of two identical requests exactly one completes the case
    // and records `case.completed` — the other is a revision conflict, and
    // its retry answers 409 "already completed".
    const index = caseFixtures.findIndex((c) => c.id === caseId && c.organizationId === organizationId);
    if (index === -1) return NextResponse.json({ error: `Case ${caseId} not found for this organization` }, { status: 404 });
    if (caseRevision(caseFixtures[index]) !== caseRevision(existing)) {
      return NextResponse.json({ error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: caseFixtures[index] }, { status: 409 });
    }
    if (transition.archive) updated = { ...updated, isDeleted: true, archivedAt: completion.completedAt };
    updated = { ...updated, revision: caseRevision(existing) + 1 };
    caseFixtures[index] = updated;
  } else {
    // Re-decided from every fresh read; the last refusal is what we answer.
    const now = completion.completedAt;
    const actorName = completion.completedByName ?? null;
    let refusal: { status: number; body: Record<string, unknown> } | null = null;
    const written = await updateCaseWithRetry(
      organizationId,
      caseId,
      (fresh) => {
        if (expectedRevision !== undefined && caseRevision(fresh.data) !== expectedRevision) {
          refusal = { status: 409, body: { error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: fresh.case_ } };
          return { refuse: 'revision' };
        }
        const freshDecision = decideManualCompletion(fresh.case_, { actorHasPermission, actorIdentityId: userId, actorName, reason: b.reason, now });
        if (!freshDecision.allowed) {
          refusal = { status: freshDecision.status, body: { error: freshDecision.error, ...(freshDecision.reasons ? { details: freshDecision.reasons } : {}) } };
          return { refuse: 'decision' };
        }
        const freshUpdated: Case = { ...fresh.case_, ...freshDecision.patch };
        const freshEvaluation = evaluateCaseCompletion(freshUpdated);
        if (!freshEvaluation.eligible) {
          refusal = { status: 422, body: { error: 'This case could not be completed.', details: freshEvaluation.reasons } };
          return { refuse: 'not_eligible' };
        }
        const freshTransition = completionTransition(fresh.case_, freshUpdated);
        evaluation = freshEvaluation;
        transition = freshTransition;
        completion = freshDecision.patch.manualCompletion;
        return {
          ...buildCaseFieldPatch(fresh.data, {
            rawStage: freshDecision.patch.rawStage,
            daysWaitingInStage: freshDecision.patch.daysWaitingInStage,
            ...(freshTransition.archive ? { isDeleted: true, archivedAt: completion.completedAt } : {}),
          }),
          manualCompletion: completion,
        };
      },
      { first: loadedRow! },
    );
    if (written.result === 'refused') {
      const answer = refusal as { status: number; body: Record<string, unknown> } | null;
      return NextResponse.json(answer?.body ?? { error: written.reason }, { status: answer?.status ?? 409 });
    }
    if (written.result === 'not_found') return NextResponse.json({ error: `Case ${caseId} not found for this organization` }, { status: 404 });
    if (written.result === 'conflict') {
      return NextResponse.json({ error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: written.current }, { status: 409 });
    }
    if (written.result === 'failed') {
      return NextResponse.json({ error: `The case could not be saved (${written.reason}). Nothing was changed — try again.` }, { status: 503 });
    }
    updated = written.case_;
  }
  const correlationId = crypto.randomUUID();

  // Best-effort, like every other activity event — the completion stands.
  try {
    await recordCaseCompleted(
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId },
      caseId,
      {
        mode: 'manual',
        policyKind: policy.kind,
        requiresRemainsReturn: policy.requiresRemainsReturn,
        requiredFinalItems: policy.requiredFinalItems,
        legacyPolicy: evaluation.isLegacyPolicy,
        archivesOnCompletion: policy.archiveEligibility === 'on_completion',
        reason: completion.reason,
        workflowTemplateId: existing.workflowTemplateId,
        workflowTemplateVersion: existing.workflowTemplateVersion,
        serviceTypeCode: existing.workflowSnapshot?.serviceTypeCode ?? null,
      },
      dataAdapterMode,
    );
    if (transition.archive) {
      await recordCaseArchiveChanged(
        { organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId, isSystemGenerated: true },
        caseId,
        true,
        dataAdapterMode,
      );
    }
  } catch (error) {
    console.error('Failed to record case.completed activity event:', error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ case: updated, completion: { mode: evaluation.mode, archived: transition.archive } });
}

