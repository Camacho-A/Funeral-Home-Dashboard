import { describe, expect, it } from 'vitest';
import {
  fieldMapForForm,
  FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
  ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
  VITAL_STATISTICS_EXTERNAL_FORM_ID,
} from './fieldMapping';

/**
 * Middle name (2026-10). Every qid below was read from the live Jotform
 * form definitions, not guessed: all three Manors forms ask for the
 * decedent's name as a `control_fullname` with the middle sub-field
 * enabled, so each submission already carries {first, middle, last,
 * suffix} and SOLIS was simply discarding the middle.
 */
describe('decedent middle name is mapped from all three forms', () => {
  const EXPECTED = [
    { form: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, qid: '3', jotformName: 'nameof' },
    { form: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, qid: '87', jotformName: 'name87' },
    { form: VITAL_STATISTICS_EXTERNAL_FORM_ID, qid: '3', jotformName: 'nameof' },
  ];

  it.each(EXPECTED)('maps the middle sub-field on form $form', ({ form, qid, jotformName }) => {
    const entry = fieldMapForForm('jotform', form)?.find((e) => e.solisField === 'decedentMiddleName');
    expect(entry).toBeDefined();
    expect(entry?.qid).toBe(qid);
    expect(entry?.jotformName).toBe(jotformName);
    expect(entry?.subfield).toBe('middle');
  });

  it('reads the middle name off the same question as first and last', () => {
    // If these ever diverged, the middle name would come from a different
    // person's name field — the one failure mode worth pinning.
    for (const { form } of EXPECTED) {
      const map = fieldMapForForm('jotform', form)!;
      const first = map.find((e) => e.solisField === 'decedentName' && e.subfield === 'first');
      const middle = map.find((e) => e.solisField === 'decedentMiddleName');
      expect(middle?.qid, form).toBe(first?.qid);
    }
  });
});
