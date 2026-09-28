import type { PickupStatus } from '../../types/case';
import { isValidCalendarDate } from '../../utils/inputMask';

/**
 * Staff-facing terminology (2026-09). `pickupStatus === 'released'` (UI
 * label "Family Picked Up" — see components/case/CaseInformationCard.tsx's
 * PICKUP_STATUS_LABEL) used to be persistable with `pickupReleasedTo`/
 * `pickupReleasedAt` left blank, which the item #18 audit flagged as a real
 * staleness risk (a Jotform-reconciled `pickupReleasedTo` could land while
 * `pickupStatus` stayed `'awaiting_pickup'`, or vice versa). This module is
 * the single source of truth for the new invariant: a case may never
 * persist `pickupStatus === 'released'` unless both detail fields are
 * already valid. `pickupNote` remains optional and plays no part in this
 * check.
 *
 * `isValidCalendarDate('')` treats a blank date as valid (correct for most
 * optional date fields, per its own comment), which is why blankness is
 * checked separately here — a required date must be both non-blank and
 * calendar-valid.
 */
function isNonBlank(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidPickupReleaseDetail(pickupReleasedTo: string | null, pickupReleasedAt: string | null): boolean {
  return isNonBlank(pickupReleasedTo) && isNonBlank(pickupReleasedAt) && isValidCalendarDate(pickupReleasedAt);
}

export const PICKUP_RELEASE_VALIDATION_ERROR =
  'Marking cremated remains as Family Picked Up requires a valid Released To and Released Date.';

/**
 * Given the case's current persisted pickup fields and an incoming partial
 * patch, throws if the *resulting* (merged) record would have
 * `pickupStatus === 'released'` without both detail fields valid — this
 * covers both the transition into `'released'` and any later edit that
 * would clear an already-released case's Released To/Released Date back to
 * blank. A patch that never touches these three fields, or that moves
 * `pickupStatus` to `'awaiting_pickup'`, always passes trivially — reverting
 * is never blocked. Called from both persistence chokepoints:
 * services/casesService.ts#update (mock mode) and
 * app/api/cases/[caseId]/route.ts's PATCH handler (Wix mode).
 */
export function assertValidPickupReleasePatch(
  existing: { pickupStatus: PickupStatus; pickupReleasedTo: string | null; pickupReleasedAt: string | null },
  patch: { pickupStatus?: PickupStatus; pickupReleasedTo?: string | null; pickupReleasedAt?: string | null },
): void {
  const effectiveStatus = patch.pickupStatus !== undefined ? patch.pickupStatus : existing.pickupStatus;
  if (effectiveStatus !== 'released') return;

  const effectiveReleasedTo = patch.pickupReleasedTo !== undefined ? patch.pickupReleasedTo : existing.pickupReleasedTo;
  const effectiveReleasedAt = patch.pickupReleasedAt !== undefined ? patch.pickupReleasedAt : existing.pickupReleasedAt;
  if (!isValidPickupReleaseDetail(effectiveReleasedTo, effectiveReleasedAt)) {
    throw new Error(PICKUP_RELEASE_VALIDATION_ERROR);
  }
}
