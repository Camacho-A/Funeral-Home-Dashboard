import type { StageTemplate } from '../../types/workflowTemplate';

/**
 * Finding a workflow step by its stable id (2026-11). A snapshot built on
 * the shared foundation carries stepIds (domain/workflow/cremationFoundation.ts),
 * so shared logic can find "Permit sent to crematory" wherever an
 * organization's template places it — even after a service extension
 * inserts a stage before it. Returns the item's storage coordinates, or
 * null when the snapshot has no such step.
 */
export function findStep(stages: readonly StageTemplate[] | null | undefined, stepId: string): { displayStage: number; index: number } | null {
  for (const stage of stages ?? []) {
    const item = stage.checklist.items.find((candidate) => candidate.stepId === stepId);
    if (item) return { displayStage: stage.displayStage, index: item.index };
  }
  return null;
}

/** Whether a snapshot was built with stable step ids at all. */
export function hasStepIds(stages: readonly StageTemplate[] | null | undefined): boolean {
  return (stages ?? []).some((stage) => stage.checklist.items.some((item) => typeof item.stepId === 'string'));
}
