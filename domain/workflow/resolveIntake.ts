import type { IntakeTemplate } from '../../types/workflowTemplate';

/**
 * Maps a New Case modal's typed draft values (keyed by IntakeFieldTemplate.key)
 * onto the checklist's field indices via each field's own checklistItemIndex
 * — generalizes the pre-Phase-11 domain/cases/checklist.ts#buildIntakeFieldValues,
 * which assumed fixed numeric positions matching only the Managed Cremations
 * checklist. Fields that share a checklistItemIndex (the "Next of kin name"/
 * "Next of kin phone" pair feeding one combined "Family contact" checklist
 * item) are joined with " — ", matching the original combining behavior
 * exactly — see NewCaseModal.tsx's own comment on that deviation.
 *
 * Phase 19A (Secure Payment Architecture): a fieldType 'payment' field is
 * explicitly, unconditionally skipped here — never included in the
 * returned Record, regardless of what `draft` holds for its key. This is
 * the hard, defense-in-depth guarantee behind "buildIntakeFieldValues must
 * never serialize payment data": NewCaseModal.tsx never actually writes a
 * payment field's collected values into `draft` in the first place (they
 * live in an entirely separate, isolated local state — see that
 * component's own comment), so this skip is a second, independent layer,
 * not the only one — even a caller that (by mistake, or via a forged
 * object) passed a payment field's key into `draft` could never have it
 * reach the returned fieldValues. See
 * docs/adr/ADR-021-secure-payment-architecture.md.
 */
export function buildIntakeFieldValues(
  intake: IntakeTemplate,
  draft: Record<string, string>,
): Record<number, string> {
  const valuesByIndex = new Map<number, string[]>();

  for (const section of intake.sections) {
    for (const field of section.fields) {
      if (field.fieldType === 'payment') continue;
      if (field.checklistItemIndex == null) continue;
      const value = (draft[field.key] ?? '').trim();
      if (!value) continue;
      const existing = valuesByIndex.get(field.checklistItemIndex) ?? [];
      existing.push(value);
      valuesByIndex.set(field.checklistItemIndex, existing);
    }
  }

  const result: Record<number, string> = {};
  valuesByIndex.forEach((values, index) => {
    result[index] = values.join(' — ');
  });
  return result;
}

/**
 * The subset of intake fields that also populate a structured Case field
 * (mapsToCaseField) rather than only feeding the checklist's free-text
 * fieldValues — e.g. decedentName, placeOfDeath. Returned as a plain
 * key→value record; the caller (casesService.create) decides how to apply
 * each onto the new Case.
 *
 * Phase 19A: same explicit payment-field skip as buildIntakeFieldValues
 * above, for the same reason — a 'payment' field is never eligible to
 * populate a structured Case property either (it has no `mapsToCaseField`
 * in practice, but this guarantees it structurally rather than by
 * omission).
 */
export function buildStructuredCaseFields(
  intake: IntakeTemplate,
  draft: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const section of intake.sections) {
    for (const field of section.fields) {
      if (field.fieldType === 'payment') continue;
      if (!field.mapsToCaseField) continue;
      const value = (draft[field.key] ?? '').trim();
      if (value) result[field.mapsToCaseField] = value;
    }
  }
  return result;
}

/**
 * The inverse lookup of buildStructuredCaseFields: given a structured Case
 * field name (e.g. 'weight'), finds the intake field that maps to it and
 * returns its checklistItemIndex — the fieldValues key that field's
 * checklist item reads its "done" state from (domain/workflow/
 * resolveChecklist.ts's isFieldDone). Returns null when no intake field
 * maps to that Case field, or when the matching field has no
 * checklistItemIndex — either way, there is no fieldValues key to keep in
 * sync for it.
 *
 * Exists so that editing a structured Case field which is *also* a
 * field-backed checklist item (Weight today; Time of Death and the
 * Hospice/physician contact are the same shape, added to this pattern in a
 * later step) can write both Case.<field> and the corresponding
 * fieldValues[index] from one place, instead of the checklist item
 * silently staying "incomplete" after a save that only touched the
 * structured property. Never assumes a fixed index (e.g. weight isn't
 * hardcoded to 3 anywhere) — this always resolves against the case's own
 * workflowSnapshot.intake, so it stays correct for any organization's
 * template shape.
 */
export function findChecklistIndexForCaseField(intake: IntakeTemplate, caseField: string): number | null {
  for (const section of intake.sections) {
    for (const field of section.fields) {
      if (field.mapsToCaseField === caseField && field.checklistItemIndex !== undefined) {
        return field.checklistItemIndex;
      }
    }
  }
  return null;
}

/**
 * The inverse of findChecklistIndexForCaseField above: given a checklist
 * fieldValues index, finds the structured Case field it maps to (if any).
 * Returns null when no intake field has this checklistItemIndex, or when
 * the matching field has no mapsToCaseField (the common case — most
 * field-backed checklist items are pure free text with no structured
 * counterpart at all).
 *
 * Case Information sync fix (2026-09): exists so a write path that only
 * ever touches fieldValues (ChecklistCard's own field-backed textbox,
 * wired through hooks/useCaseMutations.ts#setFieldValue) can still be
 * recognized, at the server persistence boundary, as also needing to
 * update the structured Case property Case Information actually reads
 * (Weight, Time of Death) — see deriveCaseFieldSyncFromFieldValues below,
 * the function that actually uses this lookup.
 */
export function findCaseFieldForChecklistIndex(intake: IntakeTemplate, index: number): string | null {
  for (const section of intake.sections) {
    for (const field of section.fields) {
      if (field.checklistItemIndex === index && field.mapsToCaseField) {
        return field.mapsToCaseField;
      }
    }
  }
  return null;
}

/**
 * Case Information sync fix (2026-09). Given a fieldValues patch (already
 * fully merged/normalized — the shape every fieldValues-touching caller
 * already sends, e.g. `{ ...case_.fieldValues, [index]: value }`) and the
 * case's own workflowSnapshot.intake, derives which structured Case
 * fields should be updated to match, so a field-backed checklist item's
 * own edit (Weight, Time of Death) is never silently invisible in Case
 * Information. This is the ONE place that sync is computed — both
 * lib/wixCaseMapper.ts#applyCaseUpdateToWixData (DATA_ADAPTER=wix) and
 * services/casesService.ts#update (DATA_ADAPTER=mock) call this exact
 * function, so the two modes can never diverge.
 *
 * `alreadyPatchedFields` is the set of Case-field keys the SAME patch
 * already sets explicitly (e.g. hooks/useCaseMutations.ts#setWeight's own
 * combined `{ weight, fieldValues }` patch) — that value always wins;
 * this function only fills in a structured field a caller's patch left
 * untouched, never overrides one it set on purpose.
 */
export function deriveCaseFieldSyncFromFieldValues(
  intake: IntakeTemplate,
  normalizedFieldValues: Record<number, string>,
  alreadyPatchedFields: ReadonlySet<string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [indexKey, value] of Object.entries(normalizedFieldValues)) {
    const caseField = findCaseFieldForChecklistIndex(intake, Number(indexKey));
    if (caseField && !alreadyPatchedFields.has(caseField)) {
      result[caseField] = value;
    }
  }
  return result;
}
