import type { Case, ReturnMethod } from '../../types/case';

/**
 * Conditional shipping/tracking (2026-09). The single source of truth for
 * whether a case's terminal "return of cremated remains to the family"
 * requirement is satisfied — replaces the old, independent, manually-
 * toggled "Family picked up ashes" checklist checkbox (see
 * `domain/cases/transitions.ts#resolveEffectiveDisplayStage`'s own comment
 * for why that mechanism was retired rather than kept as a second,
 * competing signal).
 *
 * Deliberately per-`ReturnMethod`, not a single boolean field on Case:
 * - `'pickup'` is done only once `pickupStatus === 'released'` — the exact
 *   same structured field the pickup UI/RBAC (`domain/cases/pickupView.ts`)
 *   already reads and writes.
 * - `'shipping'` is done only once `shippingDeliveryStatus === 'delivered'`
 *   — a tracking number, carrier, or "shipped" status alone is
 *   insufficient; the remains must be confirmed delivered.
 * - `'undecided'` is never done. There is no neutral "mark complete anyway"
 *   escape hatch — an undecided case cannot appear Completed on this
 *   requirement, by construction (no manual checkbox exists at all
 *   anymore for this item).
 */
export function isTerminalReturnRequirementComplete(
  case_: Pick<Case, 'returnMethod' | 'pickupStatus' | 'shippingDeliveryStatus'>,
): boolean {
  switch (case_.returnMethod) {
    case 'pickup':
      return case_.pickupStatus === 'released';
    case 'shipping':
      return case_.shippingDeliveryStatus === 'delivered';
    case 'undecided':
      return false;
  }
}

/**
 * The terminal checklist item's displayed label — overrides whatever text
 * is embedded in the case's immutable `workflowSnapshot` (still
 * `"Family picked up ashes"`, preserved as-is; see
 * `domain/cases/viewModel.ts`'s own comment on why the stored snapshot is
 * never rewritten). Applied only at the case's own last display stage.
 */
export function terminalReturnRequirementLabel(returnMethod: ReturnMethod): string {
  switch (returnMethod) {
    case 'pickup':
      return 'Family picked up ashes';
    case 'shipping':
      return 'Cremated remains confirmed delivered';
    case 'undecided':
      return 'Return of cremated remains confirmed';
  }
}

/**
 * The Case Detail page's own adaptive heading for the stage immediately
 * before Completed — a presentational overlay only (see
 * `domain/cases/viewModel.ts`'s `caseDetailStageHeading`), never a change
 * to the structural `STAGES`/snapshot label `sla.ts`/the dashboard/reports
 * key off.
 */
export function returnMethodStageHeading(returnMethod: ReturnMethod): string {
  switch (returnMethod) {
    case 'pickup':
      return 'Ready for Pickup';
    case 'shipping':
      return 'Ready for Shipping';
    case 'undecided':
      return 'Return of Cremated Remains';
  }
}

/** Every new case defaults here — never `'pickup'`, see `ReturnMethod`'s
    own comment on why silently assuming pickup would misrepresent an
    undecided family's actual state. Also the defensive default for any
    legacy/malformed row missing the field entirely. */
export const DEFAULT_RETURN_METHOD: ReturnMethod = 'undecided';

export function isValidReturnMethod(value: unknown): value is ReturnMethod {
  return value === 'undecided' || value === 'pickup' || value === 'shipping';
}

export function isValidShippingDeliveryStatus(value: unknown): value is NonNullable<Case['shippingDeliveryStatus']> {
  return value === 'shipped' || value === 'delivered';
}
