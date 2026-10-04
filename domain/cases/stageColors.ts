/**
 * SOLIS: one color per workflow stage ("Cathedral" palette). Presentation only.
 * Indexed by displayStage (0–6). Red is NOT used here, because red stays
 * reserved for "needs attention" (bottleneck stages keep their danger override).
 */
export const STAGE_COLORS: readonly string[] = [
  '#1D4170', // 0 First Call & Payment: sapphire
  '#634A86', // 1 Jotform Application: amethyst
  '#2F7F70', // 2 EDRS & Doctor / Cause of Death: jade
  '#B0603A', // 3 Permit & Authorization Sent to Crematory: terracotta
  '#717F3E', // 4 DC Application Sent: olive
  '#2D5C34', // 5 Ready for Pickup / Contact Family: hunter green
  '#454B57', // 6 Completed: charcoal
];

export function stageColor(displayStage: number): string {
  return STAGE_COLORS[displayStage] ?? 'var(--color-brand-solid-cool)';
}
