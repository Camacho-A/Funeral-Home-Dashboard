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
 * Case list scalability, Phase 2 (2026-09) — the inverse of toDisplayStage
 * above, for server-side stage filtering. Every display stage maps from
 * exactly one raw stage (`toRawStage`) except display stage 0 ("First Call
 * & Payment"), which combines raw stages 0 and 1 into one displayed dot —
 * the same special case toDisplayStage's own formula already hardcodes,
 * mirrored here rather than re-derived from a raw-stage count this module
 * doesn't otherwise track.
 */
export function rawStagesForDisplayStage(displayStage: number): number[] {
  return displayStage === 0 ? [0, 1] : [toRawStage(displayStage)];
}

/**
 * Validates a caller-supplied stage LABEL against the canonical STAGES
 * array and returns the raw stage(s) it corresponds to — the one function
 * a stage-filtering caller (GET /api/cases, GET /api/cases/counts) actually
 * needs, so neither has to duplicate the STAGES.indexOf lookup. Returns
 * null for any string that isn't an exact STAGES entry — the caller's own
 * job to turn that into a 400, never a silent "All Cases" fallback.
 */
export function rawStagesForStageLabel(label: string): number[] | null {
  const index = (STAGES as readonly string[]).indexOf(label);
  return index === -1 ? null : rawStagesForDisplayStage(index);
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
