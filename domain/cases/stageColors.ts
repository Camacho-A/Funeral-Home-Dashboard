/**
 * SOLIS: one color per workflow stage ("Stone & clay" palette). Presentation only.
 * Indexed by displayStage (0–6). Red is NOT used here, because red stays
 * reserved for "needs attention" (bottleneck stages keep their danger override).
 */
export const STAGE_COLORS: readonly string[] = [
  '#4E6E8E', // 0 First Call & Payment: slate blue
  '#7D6B91', // 1 Jotform Application: heather
  '#6D9C93', // 2 EDRS & Doctor / Cause of Death: sage teal
  '#C98B5E', // 3 Permit & Authorization Sent to Crematory: clay
  '#94A17A', // 4 DC Application Sent: olive sage
  '#557A46', // 5 Ready for Pickup / Contact Family: forest
  '#6C7280', // 6 Completed: stone gray
];

export function stageColor(displayStage: number): string {
  return STAGE_COLORS[displayStage] ?? 'var(--color-brand-solid-cool)';
}
