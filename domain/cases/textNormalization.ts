import type { CaseWorkflowSnapshot } from '../../types/workflowTemplate';

/**
 * SOLIS-wide ALL-CAPS data standard (2026-09). The single, authoritative,
 * server-side normalization policy for Case free-text fields — called from
 * both of Case's real persistence chokepoints (lib/wixCaseMapper.ts's
 * buildWixCaseData/validateAndPickCaseUpdate) and mirrored in
 * services/casesService.ts's mock-mode branches, so a value can never reach
 * Wix (or a mock fixture) in mixed case regardless of caller — browser UI,
 * a direct API request, or Jotform reconciliation (which applies its patch
 * through the exact same PATCH /api/cases/[caseId] route).
 *
 * Deliberately an explicit field allowlist, never a blanket
 * "uppercase every string" sweep — Case also carries enum literals
 * (paymentStatus, pickupStatus, returnMethod, shippingDeliveryStatus,
 * nextOfKinRelationship, vaPublishChoice), emails, phone numbers, dates,
 * times, and ids, all of which would break if touched.
 *
 * This is prospective only — existing Wix rows are never queried or
 * rewritten by this module; it only ever transforms a value on its way in.
 */

const UPPERCASE_STRING_FIELDS = [
  'decedentName',
  'placeOfDeath',
  'nextOfKinName',
  'pickupReleasedTo',
  'shippingCarrier',
  'nextOfKinRelationshipOther',
  'pickupNote',
  'stalledReason',
  // Existing precedent (CaseInformationCard.tsx), kept unchanged per the
  // approved policy — physical/carrier codes, not prose, but no
  // interoperability problem was ever identified with uppercasing them.
  'tagNumber',
  'shippingTrackingNumber',
] as const;

type UppercaseCaseTextField = (typeof UPPERCASE_STRING_FIELDS)[number];

function uppercaseIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

/**
 * Normalizes every allowlisted field present on `input`, leaving every
 * other key (including fieldValues, handled separately below) completely
 * untouched. Works against a partial patch (update) or a full object
 * (create) alike — only touches keys that are actually present, so an
 * `undefined` field on a patch stays `undefined` (never applied), and a
 * `null` value (e.g. a cleared `pickupNote`) stays `null`.
 */
export function normalizeCaseTextFields<T extends Partial<Record<UppercaseCaseTextField, unknown>>>(input: T): T {
  const result: Record<string, unknown> = { ...input };
  for (const field of UPPERCASE_STRING_FIELDS) {
    if (field in result) {
      result[field] = uppercaseIfString(result[field]);
    }
  }
  return result as T;
}

/**
 * fieldValues is heterogeneous per-organization intake-answer data — a
 * fixed field-name allowlist cannot work here (the same Record<number,
 * string> map holds names, numbers, and other answer types depending on
 * the org's own workflow template). Instead, per-key uppercase-ness is
 * driven entirely by the case's own immutable `workflowSnapshot.intake`
 * field config — the same `uppercase` flag NewCaseModal.tsx already reads
 * client-side for live-typing UX (domain/workflow/resolveIntakeField.ts).
 *
 * `fieldValues` keys are stored as numbers on the Case type but arrive as
 * string object keys at runtime (a plain JS object/JSON has no numeric
 * keys) — matched against each IntakeFieldTemplate's own `checklistItemIndex`,
 * the same key space fieldValues has always used (see
 * domain/workflow/resolveIntake.ts). A field with no `checklistItemIndex`,
 * or a workflowSnapshot that isn't available (null), is left untouched —
 * never a blind uppercase.
 */
export function normalizeCaseFieldValues(
  fieldValues: Record<number, string> | undefined,
  workflowSnapshot: CaseWorkflowSnapshot | null | undefined,
): Record<number, string> | undefined {
  if (!fieldValues) return fieldValues;
  if (!workflowSnapshot) return fieldValues;

  const uppercaseIndexes = new Set<number>();
  for (const section of workflowSnapshot.intake?.sections ?? []) {
    for (const field of section.fields) {
      if (field.uppercase && field.checklistItemIndex !== undefined) {
        uppercaseIndexes.add(field.checklistItemIndex);
      }
    }
  }
  if (uppercaseIndexes.size === 0) return fieldValues;

  const result: Record<number, string> = { ...fieldValues };
  for (const key of Object.keys(result)) {
    const index = Number(key);
    if (uppercaseIndexes.has(index) && typeof result[index as unknown as number] === 'string') {
      result[index as unknown as number] = result[index as unknown as number].toUpperCase();
    }
  }
  return result;
}
