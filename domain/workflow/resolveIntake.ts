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
