import type { Case } from '../../types/case';

/**
 * Manors launch-prep (Dispatch role). The redacted view a caller holding
 * only `pickup.read` (not `case.read`) receives — decedent name, case
 * number, and the pickup fields only. Deliberately excludes every other
 * Case field (NOK, financial, workflow/checklist, dates, etc.) — see
 * `pickup.read`'s own catalog comment for why. `id`/`organizationId` are
 * included since they're required to address the case at all (e.g. for
 * the pickup-update PATCH call), not because they're sensitive.
 *
 * Conditional shipping/tracking (2026-09): `returnMethod` was added here,
 * read-only, so Dispatch can tell "this case is being shipped, it's not
 * waiting for pickup here" instead of a confusing blank — explicitly NOT
 * paired with write access (`PICKUP_ONLY_PATCH_FIELDS` below is
 * deliberately unchanged) and none of the five shipping detail fields
 * (carrier/tracking number/date shipped/delivery status/delivered date)
 * are included at all — Dispatch remains pickup-only, full stop.
 */
export type PickupOnlyCaseView = Pick<
  Case,
  'id' | 'organizationId' | 'caseNumber' | 'decedentName' | 'pickupStatus' | 'pickupReleasedTo' | 'pickupReleasedAt' | 'pickupNote' | 'returnMethod'
>;

export function toPickupOnlyView(case_: Case): PickupOnlyCaseView {
  return {
    id: case_.id,
    organizationId: case_.organizationId,
    caseNumber: case_.caseNumber,
    decedentName: case_.decedentName,
    pickupStatus: case_.pickupStatus,
    pickupReleasedTo: case_.pickupReleasedTo,
    pickupReleasedAt: case_.pickupReleasedAt,
    pickupNote: case_.pickupNote,
    returnMethod: case_.returnMethod,
  };
}

/** The only fields a `pickup.update`-only caller (no `case.update`) may
    patch — anything else in the request must be rejected, never silently
    dropped (silently dropping would let a Dispatch-scoped caller believe
    a field was saved when it wasn't). Conditional shipping/tracking
    (2026-09): deliberately NOT broadened to include `returnMethod` or any
    shipping field — Dispatch may read `returnMethod` (see
    `PickupOnlyCaseView` above) but never write it, and has no visibility
    into shipping details at all. */
export const PICKUP_ONLY_PATCH_FIELDS = ['pickupStatus', 'pickupReleasedTo', 'pickupReleasedAt', 'pickupNote'] as const;
