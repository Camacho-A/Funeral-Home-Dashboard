/**
 * The 7-stage case lifecycle, ported from design/support.js's STAGES/
 * toDisplayStage/toRawStage/stageFamily. See docs/BUSINESS_RULES.md for the
 * full narrative description of each stage — this module is the executable
 * version of that document.
 *
 * Raw stages are 0-8 internally (First Call and Payment are tracked as two
 * separate raw stages, 0 and 1) but always displayed as one combined stage
 * ("First Call & Payment") — see toDisplayStage/toRawStage below.
 */

export const STAGES = [
  'First Call & Payment',
  'Jotform Application',
  'EDRS & Doctor / Cause of Death',
  'Permit & Authorization Sent to Crematory',
  'DC Application Sent',
  'Ready for Pickup / Contact Family',
  'Completed',
] as const;

export const LAST_DISPLAY_STAGE = STAGES.length - 1;

export function toDisplayStage(rawStage: number): number {
  return rawStage === 0 ? 0 : rawStage - 1;
}

export function toRawStage(displayStage: number): number {
  return displayStage === 0 ? 0 : displayStage + 1;
}

/**
 * The one stage the prototype's own chip()/stageFamily() functions flag as
 * "needs attention" red rather than neutral navy — a business fact (this is
 * the known bottleneck stage), not a generic color mapping. See
 * components/ui/Badge.tsx for how this maps to a rendered variant.
 */
export function isBottleneckStage(displayStage: number): boolean {
  return STAGES[displayStage] === 'EDRS & Doctor / Cause of Death';
}
