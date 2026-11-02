import type { Case } from '../../types/case';
import type { CaseWorkflowSnapshot, ChecklistItemTemplate, StageTemplate } from '../../types/workflowTemplate';
import { checklistItemKey } from './checklistItemKey';
import { resolveChecklist } from './resolveChecklist';
import { displayStagesInOrder, findStageByRawStage } from './resolveStages';

/**
 * Service-specific workflows (2026-10). What happens to a case's progress
 * when its service type — and therefore its workflow — changes. Pure: the
 * route (POST /api/cases/[caseId]/workflow) shows this result to staff as
 * a preview, and only writes it after they explicitly confirm.
 *
 * Checklist keys ("{displayStage}:{index}") and `fieldValues` indices only
 * mean something against the snapshot they were written for, so the old
 * state is NEVER carried over as-is. Instead:
 *
 *   1. Every old item's real done state is resolved exactly as Case Detail
 *      shows it (resolveChecklist, including "a stage the case already
 *      moved past is complete" — isPastStage).
 *   2. Each DONE old item is matched to a new item by (display stage,
 *      normalized label). Only matched items are written, as fresh keys
 *      for the NEW snapshot; a field-backed item carries its value to the
 *      new index.
 *   3. A new item with no counterpart is a new requirement and is never
 *      marked done by this function. (Rules that already derive
 *      completion from case data — payment status, certifier, family
 *      contact — keep applying, as they do for every case.)
 *   4. The new raw stage is the new workflow's first incomplete stage,
 *      computed from the remapped state — the same walk
 *      services/workflowReconciliationService.ts does. It can be EARLIER
 *      than before; the preview says so (`movesBackward`), never silently.
 *
 * The complete prior state goes into Case.workflowHistory (by the route),
 * so nothing reported as "not carried over" is ever destroyed.
 */

export type RemappedItem = {
  label: string;
  /** Stage label in the workflow the item belongs to. */
  stageLabel: string;
  displayStage: number;
  index: number;
};

export type KeptItem = { from: RemappedItem; to: RemappedItem };

export type NotCarriedItem = RemappedItem & {
  /** 'no_matching_item': the new workflow has no such step at that stage.
      'value_required': it does, but the new step needs its value entered
      (a field-backed step whose value isn't on record). */
  reason: 'no_matching_item' | 'value_required';
};

export type CaseWorkflowRemap = {
  newChecklistState: Record<string, boolean>;
  newFieldValues: Record<number, string>;
  newRawStage: number;
  previousRawStage: number;
  previousStageLabel: string | null;
  newStageLabel: string | null;
  /** The case lands on an earlier stage position than it occupied before. */
  movesBackward: boolean;
  kept: KeptItem[];
  notCarried: NotCarriedItem[];
  newRequirements: RemappedItem[];
};

export function normalizeChecklistLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchKey(displayStage: number, label: string): string {
  return `${displayStage}|${normalizeChecklistLabel(label)}`;
}

function templateItem(stage: StageTemplate, index: number): ChecklistItemTemplate | undefined {
  return stage.checklist.items.find((item) => item.index === index);
}

/** First raw stage whose checklist is not fully done — the same walk as
    workflowReconciliationService.computeFirstIncompleteRawStage, starting
    from the workflow's first stage (nothing is "already passed" in a
    workflow the case has only just been moved onto). */
function firstIncompleteRawStage(case_: Case, snapshot: CaseWorkflowSnapshot): number {
  const stages = [...snapshot.stages].sort((a, b) => a.rawStage - b.rawStage);
  if (stages.length === 0) return 0;
  for (const stage of stages) {
    const resolved = resolveChecklist(stage.checklist.items, stage.displayStage, case_, { isPastStage: false });
    if (!resolved.every((item) => item.done)) return stage.rawStage;
  }
  return stages[stages.length - 1].rawStage;
}

export function remapCaseWorkflow(
  case_: Case,
  oldSnapshot: CaseWorkflowSnapshot,
  newSnapshot: CaseWorkflowSnapshot,
): CaseWorkflowRemap {
  const oldCase: Case = { ...case_, workflowSnapshot: oldSnapshot };
  const oldCurrentStage = findStageByRawStage(oldSnapshot, case_.rawStage);
  const oldCurrentDisplayStage = oldCurrentStage?.displayStage ?? 0;

  // 1. Resolve every old item's done state, as Case Detail shows it.
  type OldItem = RemappedItem & { done: boolean; hasField: boolean };
  const oldItems: OldItem[] = [];
  for (const stage of displayStagesInOrder(oldSnapshot)) {
    const resolved = resolveChecklist(stage.checklist.items, stage.displayStage, oldCase, {
      isPastStage: stage.displayStage < oldCurrentDisplayStage,
    });
    for (const view of resolved) {
      // Match on the TEMPLATE label (presentation variants never leak in).
      const source = templateItem(stage, view.index);
      oldItems.push({
        label: source?.label ?? view.label,
        stageLabel: stage.label,
        displayStage: stage.displayStage,
        index: view.index,
        done: view.done,
        hasField: Boolean(source?.hasField),
      });
    }
  }

  // 2. Index the new workflow's items by (display stage, normalized label).
  type NewItem = RemappedItem & { item: ChecklistItemTemplate };
  const newItems: NewItem[] = [];
  const newByKey = new Map<string, NewItem>();
  for (const stage of displayStagesInOrder(newSnapshot)) {
    for (const item of stage.checklist.items) {
      const entry: NewItem = { label: item.label, stageLabel: stage.label, displayStage: stage.displayStage, index: item.index, item };
      newItems.push(entry);
      const key = matchKey(stage.displayStage, item.label);
      if (!newByKey.has(key)) newByKey.set(key, entry);
    }
  }

  const newChecklistState: Record<string, boolean> = {};
  const newFieldValues: Record<number, string> = {};
  const matched: Array<{ from: OldItem; to: NewItem }> = [];
  const notCarried: NotCarriedItem[] = [];

  for (const old of oldItems) {
    if (!old.done) continue;
    const target = newByKey.get(matchKey(old.displayStage, old.label));
    const from: RemappedItem = { label: old.label, stageLabel: old.stageLabel, displayStage: old.displayStage, index: old.index };
    if (!target) {
      notCarried.push({ ...from, reason: 'no_matching_item' });
      continue;
    }
    newChecklistState[checklistItemKey(target.displayStage, target.index)] = true;
    const value = old.hasField ? (case_.fieldValues[old.index] ?? '').toString() : '';
    if (target.item.hasField && value.trim() !== '') newFieldValues[target.index] = value;
    matched.push({ from: old, to: target });
  }

  // 3. Resolve the new workflow against the remapped state — this decides
  //    which matches actually hold (a field-backed step needs its value).
  const remappedCase: Case = {
    ...case_,
    workflowSnapshot: newSnapshot,
    checklistState: newChecklistState,
    fieldValues: newFieldValues,
    rawStage: 0,
  };
  const newDone = new Set<string>();
  for (const stage of displayStagesInOrder(newSnapshot)) {
    for (const view of resolveChecklist(stage.checklist.items, stage.displayStage, remappedCase, { isPastStage: false })) {
      if (view.done) newDone.add(checklistItemKey(stage.displayStage, view.index));
    }
  }

  const kept: KeptItem[] = [];
  for (const { from, to } of matched) {
    const toRef: RemappedItem = { label: to.label, stageLabel: to.stageLabel, displayStage: to.displayStage, index: to.index };
    const fromRef: RemappedItem = { label: from.label, stageLabel: from.stageLabel, displayStage: from.displayStage, index: from.index };
    if (newDone.has(checklistItemKey(to.displayStage, to.index))) kept.push({ from: fromRef, to: toRef });
    else notCarried.push({ ...fromRef, reason: 'value_required' });
  }

  const oldKeys = new Set(oldItems.map((old) => matchKey(old.displayStage, old.label)));
  const newRequirements: RemappedItem[] = newItems
    .filter((entry) => !oldKeys.has(matchKey(entry.displayStage, entry.label)))
    .map(({ label, stageLabel, displayStage, index }) => ({ label, stageLabel, displayStage, index }));

  // 4. Where the case lands.
  const newRawStage = firstIncompleteRawStage(remappedCase, newSnapshot);
  const newStage = findStageByRawStage(newSnapshot, newRawStage);

  return {
    newChecklistState,
    newFieldValues,
    newRawStage,
    previousRawStage: case_.rawStage,
    previousStageLabel: oldCurrentStage?.label ?? null,
    newStageLabel: newStage?.label ?? null,
    movesBackward: (newStage?.displayStage ?? 0) < oldCurrentDisplayStage,
    kept,
    notCarried,
    newRequirements,
  };
}
