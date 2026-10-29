/**
 * Resolve Workflow 2 (2026-10): which stage the case page opens when asked
 * for a workflow stage — `null` meaning the case's own current step.
 * A stage the case has passed opens as an earlier step; the current stage,
 * a later one (the case has not reached it yet) or anything invalid opens
 * the current step. Never changes the case.
 */
export function workflowStageToOpen(requested: unknown, currentDisplayStage: number): number | null {
  const stage = typeof requested === 'string' && /^\d+$/.test(requested) ? Number(requested) : typeof requested === 'number' ? requested : NaN;
  if (!Number.isInteger(stage) || stage < 0) return null;
  return stage < currentDisplayStage ? stage : null;
}
