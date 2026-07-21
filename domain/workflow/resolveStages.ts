import type { CaseWorkflowSnapshot, StageTemplate } from '../../types/workflowTemplate';

/**
 * Generic stage lookups over a case's own immutable workflow snapshot
 * (never the live WorkflowTemplate fixture) — replaces the pre-Phase-11
 * hardcoded STAGES/toDisplayStage/toRawStage/isBottleneckStage constants in
 * domain/cases/stages.ts for anything that resolves a specific case's
 * stages. domain/cases/stages.ts itself is unchanged and still used by
 * screens that only ever render Managed Cremations data today (the
 * Dashboard and Reports pages have no org-switching UI to reach a second
 * organization's differently-shaped stages) — see docs/TEMPLATE_VERSIONING.md's
 * "Known scope limits" section.
 */

export function findStageByRawStage(
  snapshot: CaseWorkflowSnapshot,
  rawStage: number,
): StageTemplate | undefined {
  return snapshot.stages.find((stage) => stage.rawStage === rawStage);
}

export function findStageByDisplayStage(
  snapshot: CaseWorkflowSnapshot,
  displayStage: number,
): StageTemplate | undefined {
  return snapshot.stages.find((stage) => stage.displayStage === displayStage);
}

/**
 * One StageTemplate per *display* position, in order — multiple raw stages
 * can share a displayStage (Managed Cremations' First Call + Payment both
 * display as one stepper dot), so this collapses those duplicates rather
 * than returning one entry per raw stage.
 */
export function displayStagesInOrder(snapshot: CaseWorkflowSnapshot): StageTemplate[] {
  const seen = new Set<number>();
  const ordered: StageTemplate[] = [];
  for (const stage of [...snapshot.stages].sort((a, b) => a.rawStage - b.rawStage)) {
    if (seen.has(stage.displayStage)) continue;
    seen.add(stage.displayStage);
    ordered.push(stage);
  }
  return ordered;
}

export function lastDisplayStage(snapshot: CaseWorkflowSnapshot): number {
  return Math.max(...snapshot.stages.map((stage) => stage.displayStage));
}

/**
 * The next raw stage after `currentRawStage`, for the Dashboard's bulk
 * "Advance to next stage" action (see hooks/useAdvanceCaseStage.ts, which
 * this doesn't call directly — it just needs *a* raw-stage successor).
 * Assumes raw stages are sequential integers with no gaps, same as every
 * template in this codebase (see docs/TEMPLATE_VERSIONING.md).
 */
export function nextRawStage(snapshot: CaseWorkflowSnapshot, currentRawStage: number): number {
  const rawStages = Array.from(new Set(snapshot.stages.map((stage) => stage.rawStage))).sort(
    (a, b) => a - b,
  );
  const index = rawStages.indexOf(currentRawStage);
  return rawStages[index + 1] ?? currentRawStage;
}

/**
 * Generalizes the old domain/cases/sla.ts's isOverdue, which compared
 * against the hardcoded LAST_DISPLAY_STAGE constant — the terminal
 * ("Completed") stage is never overdue regardless of which template a case
 * belongs to.
 */
export function isOverdue(
  targetDays: number | null,
  daysWaitingInStage: number,
  displayStage: number,
  snapshot: CaseWorkflowSnapshot,
): boolean {
  return (
    targetDays != null && daysWaitingInStage > targetDays && displayStage < lastDisplayStage(snapshot)
  );
}
