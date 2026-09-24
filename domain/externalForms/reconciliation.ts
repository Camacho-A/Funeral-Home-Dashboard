/**
 * Manors Jotform integration (case-first architecture, 2026-09). Pure
 * comparison logic behind the reconciliation UI — never mutates a Case
 * itself (that's domain/cases/* + the existing PATCH /api/cases/[caseId]
 * route's own validated update path, reused as-is; see
 * services/externalFormReconciliationService.ts). A conflicting field is
 * never pre-selected; an empty Solis field is eligible for "Apply all new
 * information" but still individually inspectable/uncheckable first.
 */
import type { MappedSolisField } from './fieldMapping';

export type ReconciliationRowState = 'match' | 'solis_empty' | 'conflict' | 'review_only';

export type ReconciliationRow = {
  field: MappedSolisField;
  currentValue: string | null;
  incomingValue: string | null;
  state: ReconciliationRowState;
  /** Whether this row may be included in a bulk "Apply all new
      information" action — true only for solis_empty rows; a conflict
      always requires its own deliberate selection, and a review_only row
      (no existing Case destination) can never be applied at all. */
  eligibleForBulkApply: boolean;
};

const APPLIABLE_FIELDS: ReadonlySet<MappedSolisField> = new Set([
  'decedentName',
  'dateOfBirth',
  'dateOfDeath',
  'placeOfDeath',
  'isVeteran',
  'nextOfKinName',
  'nextOfKinRelationship',
  'nextOfKinPhone',
  'nextOfKinEmail',
  'pickupReleasedTo',
]);

function normalize(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export function classifyReconciliationRow(field: MappedSolisField, currentValue: string | null, incomingValue: string | null): ReconciliationRow {
  if (!APPLIABLE_FIELDS.has(field)) {
    return { field, currentValue, incomingValue, state: 'review_only', eligibleForBulkApply: false };
  }
  if (incomingValue === null || incomingValue === '') {
    return { field, currentValue, incomingValue, state: 'match', eligibleForBulkApply: false };
  }
  if (currentValue === null || currentValue === '') {
    return { field, currentValue, incomingValue, state: 'solis_empty', eligibleForBulkApply: true };
  }
  if (normalize(currentValue) === normalize(incomingValue)) {
    return { field, currentValue, incomingValue, state: 'match', eligibleForBulkApply: false };
  }
  return { field, currentValue, incomingValue, state: 'conflict', eligibleForBulkApply: false };
}

export function buildReconciliationRows(
  current: Partial<Record<MappedSolisField, string | null>>,
  incoming: Partial<Record<MappedSolisField, string | null>>,
): ReconciliationRow[] {
  const fields = new Set<MappedSolisField>([...Object.keys(current), ...Object.keys(incoming)] as MappedSolisField[]);
  return [...fields].map((field) => classifyReconciliationRow(field, current[field] ?? null, incoming[field] ?? null));
}

/** "Apply all new information" — only ever the solis_empty rows, from the
    caller's own selected subset (never silently including a conflict). */
export function bulkApplyCandidates(rows: ReconciliationRow[]): MappedSolisField[] {
  return rows.filter((r) => r.eligibleForBulkApply).map((r) => r.field);
}
