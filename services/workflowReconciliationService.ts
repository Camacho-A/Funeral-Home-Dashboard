import type { DataAdapterMode } from '../lib/env';
import { buildCaseFieldPatch } from '../lib/wixCaseMapper';
import { caseFixtures } from './__mocks__/fixtures';
import { updateCaseWithRetry, writeMockCase } from './caseWriteService';
import { listForCase as listCaseFormLinks } from './caseFormLinkService';
import { getById as getExternalFormConfigById } from './externalFormConfigService';
import { resolveChecklist } from '../domain/workflow/resolveChecklist';
import { checklistItemKey } from '../domain/workflow/checklistItemKey';
import { findStageByRawStage } from '../domain/workflow/resolveStages';
import { resolveFormRole } from '../domain/externalForms/formRegistry';
import type { Case } from '../types/case';
import type { StageTemplate } from '../types/workflowTemplate';

/**
 * Manors workflow reconciliation (2026-09). Answers "given this case's
 * authoritative state right now, what is the first genuinely incomplete
 * stage?" and, if that's further along than the case's current `rawStage`,
 * advances it there. This is the ONE place that logic lives — never
 * duplicated per call site, and never a blind `rawStage + 1` (that remains
 * `domain/cases/transitions.ts#advanceToNextStage`, the separate manual
 * "Advance to next stage" action, untouched by this file).
 *
 * Root cause this exists to fix: before this, nothing ever recalculated
 * `rawStage` from ground truth. It only ever changed via that manual
 * action. A historical import landed every case at `rawStage: 0`
 * (`casesService.create`'s hardcoded default) and stayed there forever,
 * even once its Arrangement Form was linked and its Case Order became
 * PAID — because (a) `resolveChecklist` has never consulted
 * `CaseFormLink` for a form-backed checklist item (see its own doc
 * comment, deliberately unchanged by this file — see below), and (b)
 * `markCasePaidIfVerified` explicitly, deliberately never touches
 * `rawStage` on its own.
 *
 * Call this function — never a bespoke advancement — after any event that
 * could make an earlier stage newly complete: a CaseFormLink transitioning
 * to 'received'/'reviewed' (webhook receipt, historical import, manual
 * link, submission import), a payment reaching PAID
 * (`services/paymentWorkflow.ts#markCasePaidIfVerified`, which calls this
 * directly), or an administrator-triggered repair for an already-imported
 * case (`app/api/cases/[caseId]/recalculate-workflow/route.ts`).
 *
 * Idempotent and never regresses: recomputing an already-correct
 * `rawStage` is a no-op, and a case manually advanced further than its
 * "genuinely complete" prerequisites strictly justify (via the separate
 * manual action) is never pulled backward — this function only ever
 * raises `rawStage`, via `Math.max(current, computed)`.
 */

function isFormLinkReceived(status: string): boolean {
  return status === 'received' || status === 'reviewed';
}

/** Whether this case's Arrangement Form (the specific Jotform submission
    the single "Jotform application completed" checklist item stands in
    for — see checkFormLinked's own comment) has been linked, via the
    real, functional `CaseFormLink`/`ExternalFormConfig` mechanism —
    deliberately NOT `types/externalFormIntegration.ts`, which
    `ChecklistItemTemplate.externalFormIntegrationId` references but which
    is documented as dormant, never wired to any real submission
    pipeline. */
export async function isArrangementFormLinked(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const links = await listCaseFormLinks(organizationId, caseId, dataAdapterMode);
  for (const link of links) {
    if (!isFormLinkReceived(link.status) || !link.submissionId) continue;
    const config = await getExternalFormConfigById(organizationId, link.formConfigId, dataAdapterMode);
    // Organization-aware (2026-10): any form registered as this org's
    // arrangement layout — Manors' legacy form id or another home's own form.
    if (config && resolveFormRole(config) === 'arrangement') return true;
  }
  return false;
}

/**
 * Builds a checklistState overlay scoped to exactly one stage's own items
 * — never applied globally — so a form-linked item's derived-done override
 * can never bleed into a different stage. Keyed by this stage's own
 * composite "{displayStage}:{index}" key (domain/workflow/checklistItemKey.ts),
 * never a bare index, so it can never collide with another stage's own
 * item at the same local position — the exact ambiguity that used to
 * exist here (see this file's own git history for the incident it
 * caused). displayStage, not rawStage: Managed Cremations' First Call
 * (rawStage 0) and Payment (rawStage 1) intentionally share one
 * displayStage and one combined checklist — see resolveChecklist's own
 * doc comment. Deliberately does NOT mutate/persist this onto the real
 * Case row — it exists only to let `resolveChecklist` answer "is this
 * stage done" correctly for reconciliation's purposes; once reconciliation
 * advances `rawStage` past a now-complete stage, that stage's real
 * checklistState becomes moot (a past stage always renders done via
 * `isPastStage`, regardless of its stored checklistState).
 */
function buildStageOverlayCase(stage: StageTemplate, case_: Case, arrangementFormLinked: boolean): Case {
  if (!arrangementFormLinked) return case_;
  const overlay = { ...case_.checklistState };
  for (const item of stage.checklist.items) {
    if (item.externalFormIntegrationId) overlay[checklistItemKey(stage.displayStage, item.index)] = true;
  }
  return { ...case_, checklistState: overlay };
}

/** Pure function: given a case and whether its Arrangement Form is linked,
    returns the raw stage of the first stage that is NOT fully done. Walks
    `workflowSnapshot.stages` in ascending rawStage order — never assumes
    any particular stage count/shape, so it works for any organization's
    template. Returns the last stage's rawStage if every stage is fully
    done.

    A stage whose displayStage is strictly before the case's current
    displayStage is never re-evaluated — the case already, provably
    passed it (the same trust `Math.max(current, computed)` below already
    places in prior progress), so there is nothing to gain by re-checking
    it here, and doing so risks a confusing "first incomplete" answer for
    an old stage whose legacy checklistState can no longer be confidently
    attributed to it. Compared by displayStage, not rawStage, so First
    Call (rawStage 0) is never skipped relative to Payment (rawStage 1) —
    they share one displayStage and must be evaluated consistently (see
    resolveChecklist's own doc comment). Stages at or after the case's
    current displayStage are always evaluated for real, which is what
    lets a historical-import case still jump forward multiple stages in
    one call when every one of them is genuinely, evidentially complete. */
export function computeFirstIncompleteRawStage(case_: Case, arrangementFormLinked: boolean): number {
  const stages = [...(case_.workflowSnapshot?.stages ?? [])].sort((a, b) => a.rawStage - b.rawStage);
  if (stages.length === 0) return case_.rawStage;

  const currentDisplayStage = case_.workflowSnapshot
    ? findStageByRawStage(case_.workflowSnapshot, case_.rawStage)?.displayStage ?? case_.rawStage
    : case_.rawStage;

  for (const stage of stages) {
    if (stage.displayStage < currentDisplayStage) continue;
    const effectiveCase = buildStageOverlayCase(stage, case_, arrangementFormLinked);
    const resolved = resolveChecklist(stage.checklist.items, stage.displayStage, effectiveCase, { isPastStage: false });
    if (!resolved.every((item) => item.done)) return stage.rawStage;
  }
  return stages[stages.length - 1].rawStage;
}

/** `case_` is the case as written when the stage changed (carrying its new
    revision), so a caller can return it without another read. */
export type ReconcileResult = { rawStage: number; changed: boolean; case_?: Case };

/** Thrown when another write kept winning for every bounded attempt. */
export class ReconcileConflictError extends Error {
  constructor(caseId: string) {
    super(`Workflow reconciliation for case ${caseId} lost to concurrent writes on every attempt.`);
    this.name = 'ReconcileConflictError';
  }
}

/** The one entry point every call site above uses. Loads the case fresh
    (never trusts a caller-supplied copy, since the whole point is to
    react to state that may have just changed), computes the correct
    stage, and — only if that's further along — persists it. Safe to call
    for a case with no workflowSnapshot (returns unchanged; nothing to
    reconcile against) or a nonexistent case (returns rawStage: 0,
    changed: false).

    Case concurrency (2026-10): the write sets ONLY `currentStage` (+ the
    revision), conditioned on the revision it was computed from, and is
    recomputed from a fresh read if another write landed first (bounded —
    services/caseWriteService.ts). It used to re-send the whole row from a
    read taken before several other Wix reads, undoing any checklist tick or
    staff edit that landed in between. The stage still never moves
    backwards: `max(current, computed)` is re-evaluated on every attempt. An
    archived case is still left alone. */
export async function reconcileCaseWorkflow(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<ReconcileResult> {
  // Read once: whether the Arrangement Form is linked lives in CaseFormLinks,
  // not on the case row, so it does not need re-reading per attempt.
  const arrangementFormLinked = await isArrangementFormLinked(organizationId, caseId, dataAdapterMode);
  const nextStageFor = (case_: Case): number | null => {
    if (case_.isDeleted || !case_.workflowSnapshot) return null;
    const newRawStage = Math.max(case_.rawStage, computeFirstIncompleteRawStage(case_, arrangementFormLinked));
    return newRawStage === case_.rawStage ? null : newRawStage;
  };

  if (dataAdapterMode === 'mock') {
    const case_ = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId);
    if (!case_) return { rawStage: 0, changed: false };
    const newRawStage = nextStageFor(case_);
    if (newRawStage === null) return { rawStage: case_.rawStage, changed: false };
    const written = writeMockCase(organizationId, caseId, (current) => ({ ...current, rawStage: newRawStage }));
    return { rawStage: newRawStage, changed: true, ...(written ? { case_: written } : {}) };
  }

  const outcome = await updateCaseWithRetry(organizationId, caseId, (row) => {
    const newRawStage = nextStageFor(row.case_);
    return newRawStage === null ? null : buildCaseFieldPatch(row.data, { rawStage: newRawStage });
  });
  if (outcome.result === 'not_found') return { rawStage: 0, changed: false };
  if (outcome.result === 'unchanged') return { rawStage: outcome.case_.rawStage, changed: false };
  if (outcome.result === 'applied') return { rawStage: outcome.case_.rawStage, changed: true, case_: outcome.case_ };
  if (outcome.result === 'conflict') throw new ReconcileConflictError(caseId);
  throw new Error(`Workflow reconciliation for case ${caseId} failed: ${outcome.reason}`);
}
