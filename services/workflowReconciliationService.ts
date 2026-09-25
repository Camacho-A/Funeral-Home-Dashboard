import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixCaseItem, applyCaseUpdateToWixData, type WixCaseItem } from '../lib/wixCaseMapper';
import { caseFixtures } from './__mocks__/fixtures';
import { listForCase as listCaseFormLinks } from './caseFormLinkService';
import { getById as getExternalFormConfigById } from './externalFormConfigService';
import { resolveChecklist } from '../domain/workflow/resolveChecklist';
import { ARRANGEMENT_FORMS_EXTERNAL_FORM_ID } from '../domain/externalForms/fieldMapping';
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
async function isArrangementFormLinked(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const links = await listCaseFormLinks(organizationId, caseId, dataAdapterMode);
  for (const link of links) {
    if (!isFormLinkReceived(link.status) || !link.submissionId) continue;
    const config = await getExternalFormConfigById(organizationId, link.formConfigId, dataAdapterMode);
    if (config?.externalFormId === ARRANGEMENT_FORMS_EXTERNAL_FORM_ID) return true;
  }
  return false;
}

/**
 * Builds a checklistState overlay scoped to exactly one stage's own items
 * — never applied globally — so a form-linked item's derived-done override
 * can never bleed into a different stage that happens to reuse the same
 * local item index (Case.checklistState is a flat, stage-agnostic map by
 * design; see domain/workflow/resolveChecklist.ts's own doc comment on why
 * that's safe for its normal one-stage-at-a-time callers). Deliberately
 * does NOT mutate/persist this onto the real Case row — it exists only to
 * let `resolveChecklist` (itself left completely unmodified — see this
 * file's own top comment) answer "is this stage done" correctly for
 * reconciliation's purposes; once reconciliation advances `rawStage` past
 * a now-complete stage, that stage's real checklistState becomes moot (a
 * past stage always renders done via `isPastStage`, regardless of its
 * stored checklistState).
 */
function buildStageOverlayCase(stage: StageTemplate, case_: Case, arrangementFormLinked: boolean): Case {
  if (!arrangementFormLinked) return case_;
  const overlay = { ...case_.checklistState };
  for (const item of stage.checklist.items) {
    if (item.externalFormIntegrationId) overlay[item.index] = true;
  }
  return { ...case_, checklistState: overlay };
}

/** Pure function: given a case and whether its Arrangement Form is linked,
    returns the raw stage of the first stage that is NOT fully done. Walks
    `workflowSnapshot.stages` in ascending rawStage order — never assumes
    any particular stage count/shape, so it works for any organization's
    template. Returns the last stage's rawStage if every stage is fully
    done. */
export function computeFirstIncompleteRawStage(case_: Case, arrangementFormLinked: boolean): number {
  const stages = [...(case_.workflowSnapshot?.stages ?? [])].sort((a, b) => a.rawStage - b.rawStage);
  if (stages.length === 0) return case_.rawStage;

  for (const stage of stages) {
    const effectiveCase = buildStageOverlayCase(stage, case_, arrangementFormLinked);
    const resolved = resolveChecklist(stage.checklist.items, effectiveCase, { isPastStage: false });
    if (!resolved.every((item) => item.done)) return stage.rawStage;
  }
  return stages[stages.length - 1].rawStage;
}

export type ReconcileResult = { rawStage: number; changed: boolean };

/** The one entry point every call site above uses. Loads the case fresh
    (never trusts a caller-supplied copy, since the whole point is to
    react to state that may have just changed), computes the correct
    stage, and — only if that's further along — persists it. Safe to call
    for a case with no workflowSnapshot (returns unchanged; nothing to
    reconcile against) or a nonexistent case (returns rawStage: 0,
    changed: false). */
export async function reconcileCaseWorkflow(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<ReconcileResult> {
  if (dataAdapterMode === 'mock') {
    const index = caseFixtures.findIndex((c) => c.id === caseId && c.organizationId === organizationId);
    if (index === -1) return { rawStage: 0, changed: false };
    const case_ = caseFixtures[index];
    if (!case_.workflowSnapshot) return { rawStage: case_.rawStage, changed: false };

    const arrangementFormLinked = await isArrangementFormLinked(organizationId, caseId, dataAdapterMode);
    const firstIncomplete = computeFirstIncompleteRawStage(case_, arrangementFormLinked);
    const newRawStage = Math.max(case_.rawStage, firstIncomplete);
    if (newRawStage === case_.rawStage) return { rawStage: case_.rawStage, changed: false };

    caseFixtures[index] = { ...case_, rawStage: newRawStage };
    return { rawStage: newRawStage, changed: true };
  }

  const response = await queryWixDataItems<WixCaseItem>('cases', {
    filter: { beaconCaseId: caseId, organizationId, isArchived: false },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return { rawStage: 0, changed: false };

  const case_ = mapWixCaseItem(existingItem.data);
  if (!case_ || !case_.workflowSnapshot) return { rawStage: case_?.rawStage ?? 0, changed: false };

  const arrangementFormLinked = await isArrangementFormLinked(organizationId, caseId, dataAdapterMode);
  const firstIncomplete = computeFirstIncompleteRawStage(case_, arrangementFormLinked);
  const newRawStage = Math.max(case_.rawStage, firstIncomplete);
  if (newRawStage === case_.rawStage) return { rawStage: case_.rawStage, changed: false };

  const mergedData = applyCaseUpdateToWixData(existingItem.data, { rawStage: newRawStage });
  await updateWixDataItem<WixCaseItem>('cases', existingItem.id, mergedData);
  return { rawStage: newRawStage, changed: true };
}
