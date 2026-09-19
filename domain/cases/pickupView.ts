import type { Case } from '../../types/case';

/**
 * Manors launch-prep (Dispatch role). The redacted view a caller holding
 * only `pickup.read` (not `case.read`) receives — decedent name, case
 * number, and the pickup fields only. Deliberately excludes every other
 * Case field (NOK, financial, workflow/checklist, dates, etc.) — see
 * `pickup.read`'s own catalog comment for why. `id`/`organizationId` are
 * included since they're required to address the case at all (e.g. for
 * the pickup-update PATCH call), not because they're sensitive.
 */
export type PickupOnlyCaseView = Pick<
  Case,
  'id' | 'organizationId' | 'caseNumber' | 'decedentName' | 'pickupStatus' | 'pickupReleasedTo' | 'pickupReleasedAt' | 'pickupNote'
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
  };
}

/** The only fields a `pickup.update`-only caller (no `case.update`) may
    patch — anything else in the request must be rejected, never silently
    dropped (silently dropping would let a Dispatch-scoped caller believe
    a field was saved when it wasn't). */
export const PICKUP_ONLY_PATCH_FIELDS = ['pickupStatus', 'pickupReleasedTo', 'pickupReleasedAt', 'pickupNote'] as const;
