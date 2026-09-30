import { describe, expect, it } from 'vitest';
import {
  buildIntakeFieldValues,
  buildStructuredCaseFields,
  findChecklistIndexForCaseField,
  findCaseFieldForChecklistIndex,
  deriveCaseFieldSyncFromFieldValues,
} from './resolveIntake';
import type { IntakeTemplate } from '../../types/workflowTemplate';

/**
 * Phase 19A (Secure Payment Architecture). These tests exist specifically
 * to prove the hard, defense-in-depth guarantee documented on both
 * functions below: a fieldType 'payment' field's value can never surface
 * in either function's output, even if the caller's `draft` contains one
 * (which NewCaseModal.tsx never actually does — see its own comment — but
 * this guarantees it independently of that).
 */

const INTAKE_WITH_PAYMENT: IntakeTemplate = {
  sections: [
    {
      key: 'decedent',
      label: 'Decedent',
      fields: [{ key: 'decedentName', label: 'Name', checklistItemIndex: 0, mapsToCaseField: 'decedentName' }],
    },
    {
      key: 'payment',
      label: 'Payment',
      fields: [
        {
          key: 'payment',
          label: 'Payment',
          fieldType: 'payment',
          // A payment field has no checklistItemIndex/mapsToCaseField in
          // practice — but the skip in resolveIntake.ts checks fieldType
          // first, so even a forged template configuring one anyway must
          // still never surface it.
          checklistItemIndex: 8,
          mapsToCaseField: 'cardNumber',
        },
      ],
    },
  ],
};

describe('buildIntakeFieldValues — payment field exclusion (Phase 19A)', () => {
  it('never includes a payment field value, even if draft contains one under its key', () => {
    const draft = { decedentName: 'Jane Doe', payment: '4111111111111111 — 12/28 — 123' };
    const result = buildIntakeFieldValues(INTAKE_WITH_PAYMENT, draft);
    expect(result).toEqual({ 0: 'Jane Doe' });
  });

  it('never includes a payment field value even when the forged template gives it a checklistItemIndex matching another field', () => {
    const collidingIntake: IntakeTemplate = {
      sections: [
        ...INTAKE_WITH_PAYMENT.sections.slice(0, 1),
        {
          key: 'payment',
          label: 'Payment',
          fields: [{ key: 'payment', label: 'Payment', fieldType: 'payment', checklistItemIndex: 0 }],
        },
      ],
    };
    const result = buildIntakeFieldValues(collidingIntake, { decedentName: 'Jane Doe', payment: '4111 1111 1111 1111' });
    // Only the legitimate decedentName value reaches index 0 — the payment
    // field's value is never joined in, even though it shares the index.
    expect(result[0]).toBe('Jane Doe');
  });

  it('leaves non-payment fields completely unaffected', () => {
    const intake: IntakeTemplate = {
      sections: [
        {
          key: 's',
          label: 'S',
          fields: [
            { key: 'a', label: 'A', checklistItemIndex: 0 },
            { key: 'b', label: 'B', checklistItemIndex: 0 },
            { key: 'c', label: 'C', checklistItemIndex: 1 },
          ],
        },
      ],
    };
    const result = buildIntakeFieldValues(intake, { a: 'first', b: 'second', c: 'third' });
    expect(result).toEqual({ 0: 'first — second', 1: 'third' });
  });
});

describe('buildStructuredCaseFields — payment field exclusion (Phase 19A)', () => {
  it('never includes a payment field value, even if a forged template gives it a mapsToCaseField', () => {
    const draft = { decedentName: 'Jane Doe', payment: '4111111111111111' };
    const result = buildStructuredCaseFields(INTAKE_WITH_PAYMENT, draft);
    expect(result).toEqual({ decedentName: 'Jane Doe' });
    expect(result.cardNumber).toBeUndefined();
  });

  it('leaves non-payment mapsToCaseField fields completely unaffected', () => {
    const intake: IntakeTemplate = {
      sections: [
        {
          key: 's',
          label: 'S',
          fields: [
            { key: 'decedentName', label: 'Name', mapsToCaseField: 'decedentName' },
            { key: 'weight', label: 'Weight', mapsToCaseField: 'weight' },
          ],
        },
      ],
    };
    const result = buildStructuredCaseFields(intake, { decedentName: 'Jane Doe', weight: '150 lb' });
    expect(result).toEqual({ decedentName: 'Jane Doe', weight: '150 lb' });
  });
});

/**
 * Case-field-editing intake sync (2026-09). `findChecklistIndexForCaseField`
 * is what lets editing a structured Case property that's also a
 * field-backed checklist item (Weight today) keep fieldValues[index] in
 * sync in the same save — see hooks/useCaseMutations.ts#setWeight, the
 * first caller.
 */
describe('findChecklistIndexForCaseField', () => {
  const STANDARD_CREMATION_LIKE_INTAKE: IntakeTemplate = {
    sections: [
      {
        key: 'decedent',
        label: 'Decedent',
        fields: [
          { key: 'decedentName', label: 'Name of deceased', checklistItemIndex: 0, mapsToCaseField: 'decedentName' },
          { key: 'weight', label: 'Weight', checklistItemIndex: 3, mapsToCaseField: 'weight' },
          { key: 'timeOfDeath', label: 'Time of death', checklistItemIndex: 5, mapsToCaseField: 'timeOfDeath' },
        ],
      },
      {
        key: 'contacts',
        label: 'Contacts',
        fields: [
          // dcContact has no mapsToCaseField — never a structured Case
          // property, only a checklist field — must never be returned for
          // any caseField lookup.
          { key: 'dcContact', label: 'Hospice/physician', checklistItemIndex: 6 },
        ],
      },
    ],
  };

  it('finds the checklistItemIndex for a Case field mapped by the intake (Weight)', () => {
    expect(findChecklistIndexForCaseField(STANDARD_CREMATION_LIKE_INTAKE, 'weight')).toBe(3);
  });

  it('finds the checklistItemIndex for a different mapped Case field (Time of death)', () => {
    expect(findChecklistIndexForCaseField(STANDARD_CREMATION_LIKE_INTAKE, 'timeOfDeath')).toBe(5);
  });

  it('returns null for a Case field no intake field maps to', () => {
    expect(findChecklistIndexForCaseField(STANDARD_CREMATION_LIKE_INTAKE, 'nextOfKinPhone')).toBeNull();
  });

  it('returns null for a field that has mapsToCaseField but no checklistItemIndex', () => {
    const intake: IntakeTemplate = {
      sections: [{ key: 's', label: 'S', fields: [{ key: 'weight', label: 'Weight', mapsToCaseField: 'weight' }] }],
    };
    expect(findChecklistIndexForCaseField(intake, 'weight')).toBeNull();
  });

  it('never returns a payment field\'s index, even if one were forged with a matching mapsToCaseField', () => {
    const intake: IntakeTemplate = {
      sections: [
        {
          key: 'payment',
          label: 'Payment',
          fields: [{ key: 'payment', label: 'Payment', fieldType: 'payment', checklistItemIndex: 8, mapsToCaseField: 'weight' }],
        },
      ],
    };
    // Not a hard requirement of the function's contract (fieldType isn't
    // checked), but documents the actual current behavior so a future
    // change to this function's payment-safety posture is a deliberate,
    // reviewed choice rather than a silent regression.
    expect(findChecklistIndexForCaseField(intake, 'weight')).toBe(8);
  });
});

/**
 * Case Information sync fix (2026-09). `findCaseFieldForChecklistIndex` is
 * the inverse of `findChecklistIndexForCaseField` above — the direction
 * needed when a write path only has an index (ChecklistCard's own
 * field-backed textbox, via hooks/useCaseMutations.ts#setFieldValue),
 * never a caseField name directly.
 */
describe('findCaseFieldForChecklistIndex', () => {
  const STANDARD_CREMATION_LIKE_INTAKE: IntakeTemplate = {
    sections: [
      {
        key: 'decedent',
        label: 'Decedent',
        fields: [
          { key: 'decedentName', label: 'Name of deceased', checklistItemIndex: 0, mapsToCaseField: 'decedentName' },
          { key: 'weight', label: 'Weight', checklistItemIndex: 3, mapsToCaseField: 'weight' },
          { key: 'timeOfDeath', label: 'Time of death', checklistItemIndex: 5, mapsToCaseField: 'timeOfDeath' },
        ],
      },
      {
        key: 'contacts',
        label: 'Contacts',
        fields: [{ key: 'dcContact', label: 'Hospice/physician', checklistItemIndex: 6 }],
      },
    ],
  };

  it('finds the mapped Case field for a field-backed index (Weight)', () => {
    expect(findCaseFieldForChecklistIndex(STANDARD_CREMATION_LIKE_INTAKE, 3)).toBe('weight');
  });

  it('finds the mapped Case field for a different index (Time of death)', () => {
    expect(findCaseFieldForChecklistIndex(STANDARD_CREMATION_LIKE_INTAKE, 5)).toBe('timeOfDeath');
  });

  it('returns null for an index with no mapsToCaseField at all (dcContact — pure free text)', () => {
    expect(findCaseFieldForChecklistIndex(STANDARD_CREMATION_LIKE_INTAKE, 6)).toBeNull();
  });

  it('returns null for an index no intake field uses', () => {
    expect(findCaseFieldForChecklistIndex(STANDARD_CREMATION_LIKE_INTAKE, 99)).toBeNull();
  });
});

/**
 * Ambiguous-index fix (2026-09, NOK name/phone corruption root cause).
 * Family Contact (checklistItemIndex 7) maps BOTH nextOfKinName and
 * nextOfKinPhone to the same index — the real bug: findCaseFieldForChecklistIndex
 * used to return whichever field was listed first (always nextOfKinName),
 * causing deriveCaseFieldSyncFromFieldValues to write the whole combined
 * "Name — Phone" fieldValues[7] string into Case.nextOfKinName. These tests
 * prove the fix: an index with more than one distinct mapsToCaseField now
 * resolves to null (no sync), while single-field indices are unaffected.
 */
describe('findCaseFieldForChecklistIndex — ambiguous multi-field index', () => {
  const FAMILY_CONTACT_LIKE_INTAKE: IntakeTemplate = {
    sections: [
      {
        key: 'decedent',
        label: 'Decedent',
        fields: [{ key: 'weight', label: 'Weight', checklistItemIndex: 3, mapsToCaseField: 'weight' }],
      },
      {
        key: 'contacts',
        label: 'Contacts',
        fields: [
          {
            key: 'nextOfKinName',
            label: 'Next of kin — name',
            checklistItemIndex: 7,
            mapsToCaseField: 'nextOfKinName',
          },
          {
            key: 'nextOfKinPhone',
            label: 'Next of kin — phone number',
            checklistItemIndex: 7,
            mapsToCaseField: 'nextOfKinPhone',
          },
        ],
      },
    ],
  };

  it('returns null for an index mapped to two distinct Case fields (Family Contact), never the first match', () => {
    expect(findCaseFieldForChecklistIndex(FAMILY_CONTACT_LIKE_INTAKE, 7)).toBeNull();
  });

  it('still returns the single Case field for an unambiguous index (Weight), unaffected by the fix', () => {
    expect(findCaseFieldForChecklistIndex(FAMILY_CONTACT_LIKE_INTAKE, 3)).toBe('weight');
  });

  it('treats the same mapsToCaseField repeated across fields at one index as unambiguous (still resolves)', () => {
    const intake: IntakeTemplate = {
      sections: [
        {
          key: 's',
          label: 'S',
          fields: [
            { key: 'a', label: 'A', checklistItemIndex: 2, mapsToCaseField: 'weight' },
            { key: 'b', label: 'B', checklistItemIndex: 2, mapsToCaseField: 'weight' },
          ],
        },
      ],
    };
    expect(findCaseFieldForChecklistIndex(intake, 2)).toBe('weight');
  });
});

/**
 * Case Information sync fix (2026-09). This is the actual root-cause fix
 * for "Time of Death/Weight entered via the checklist never appear in
 * Case Information": ChecklistCard's own field-backed textbox commits
 * through hooks/useCaseMutations.ts#setFieldValue, which only ever
 * patches `fieldValues` — this function is what lets the server
 * persistence boundary (lib/wixCaseMapper.ts#applyCaseUpdateToWixData /
 * services/casesService.ts#update) recognize that gap and fill in the
 * structured Case field too, for any caller, present or future.
 */
describe('deriveCaseFieldSyncFromFieldValues', () => {
  const INTAKE: IntakeTemplate = {
    sections: [
      {
        key: 'decedent',
        label: 'Decedent',
        fields: [
          { key: 'weight', label: 'Weight', checklistItemIndex: 3, mapsToCaseField: 'weight' },
          { key: 'timeOfDeath', label: 'Time of death', checklistItemIndex: 5, mapsToCaseField: 'timeOfDeath' },
        ],
      },
      {
        key: 'contacts',
        label: 'Contacts',
        fields: [{ key: 'dcContact', label: 'Hospice/physician', checklistItemIndex: 6 }],
      },
    ],
  };

  it('derives the structured field patch for a fieldValues-only change (the ChecklistCard gap)', () => {
    const result = deriveCaseFieldSyncFromFieldValues(INTAKE, { 3: '178 lb' }, new Set());
    expect(result).toEqual({ weight: '178 lb' });
  });

  it('derives multiple structured fields when multiple mapped indices are present', () => {
    const result = deriveCaseFieldSyncFromFieldValues(INTAKE, { 3: '178 lb', 5: '14:30' }, new Set());
    expect(result).toEqual({ weight: '178 lb', timeOfDeath: '14:30' });
  });

  it('never derives anything for an index with no mapsToCaseField (dcContact)', () => {
    const result = deriveCaseFieldSyncFromFieldValues(INTAKE, { 6: 'Dr. Smith — 555-0100' }, new Set());
    expect(result).toEqual({});
  });

  it('never overrides a structured field the same patch already sets explicitly', () => {
    const result = deriveCaseFieldSyncFromFieldValues(INTAKE, { 3: '178 lb' }, new Set(['weight']));
    expect(result).toEqual({});
  });

  it('returns an empty object for an empty fieldValues patch', () => {
    expect(deriveCaseFieldSyncFromFieldValues(INTAKE, {}, new Set())).toEqual({});
  });

  describe('legacy Time of Death normalization (Task #6 follow-up, 2026-09)', () => {
    it.each([
      ['11:30AM', '11:30'],
      ['11:30 AM', '11:30'],
      ['11:30am', '11:30'],
      ['11:30 am', '11:30'],
      ['3:45PM', '15:45'],
      ['3:45 PM', '15:45'],
      ['03:45PM', '15:45'],
      ['03:45 PM', '15:45'],
      ['15:45', '15:45'],
      ['03:45', '03:45'],
    ])('normalizes fieldValues[5] = %j into Case.timeOfDeath = %j, never the raw legacy text', (raw, expected) => {
      const result = deriveCaseFieldSyncFromFieldValues(INTAKE, { 5: raw }, new Set());
      expect(result).toEqual({ timeOfDeath: expected });
    });

    it.each(['25:00', '13:75', 'abc', '3pm-ish', 'unknown', 'noon-ish'])(
      'excludes timeOfDeath from the result entirely when fieldValues[5] = %j cannot be safely parsed — never guesses',
      (raw) => {
        const result = deriveCaseFieldSyncFromFieldValues(INTAKE, { 5: raw }, new Set());
        expect(result).toEqual({});
      },
    );

    it('an unparseable Time of Death does not block sync of other simultaneously-mapped fields', () => {
      const result = deriveCaseFieldSyncFromFieldValues(INTAKE, { 3: '178 lb', 5: 'unknown' }, new Set());
      expect(result).toEqual({ weight: '178 lb' });
    });

    it('Weight is never passed through the legacy time parser — an arbitrary weight string syncs verbatim', () => {
      const result = deriveCaseFieldSyncFromFieldValues(INTAKE, { 3: '178 lb, approx' }, new Set());
      expect(result).toEqual({ weight: '178 lb, approx' });
    });
  });

  /**
   * Ambiguous-index fix (2026-09, NOK name/phone corruption root cause).
   * Family Contact (index 7) maps both nextOfKinName and nextOfKinPhone to
   * the same checklistItemIndex. Before the fix, a legacy combined
   * fieldValues[7] value like "EMMA MORALES SILVA — (954) 901-4165" was
   * written wholesale into Case.nextOfKinName (findCaseFieldForChecklistIndex
   * always picked the first-listed field). These tests prove that can never
   * happen again, while unambiguous single-field sync (Weight, Time of
   * Death) keeps working exactly as before.
   */
  describe('ambiguous multi-field index — Family Contact (2026-09 NOK corruption fix)', () => {
    const INTAKE_WITH_FAMILY_CONTACT: IntakeTemplate = {
      sections: [
        {
          key: 'decedent',
          label: 'Decedent',
          fields: [
            { key: 'weight', label: 'Weight', checklistItemIndex: 3, mapsToCaseField: 'weight' },
            { key: 'timeOfDeath', label: 'Time of death', checklistItemIndex: 5, mapsToCaseField: 'timeOfDeath' },
          ],
        },
        {
          key: 'contacts',
          label: 'Contacts',
          fields: [
            {
              key: 'nextOfKinName',
              label: 'Next of kin — name',
              checklistItemIndex: 7,
              mapsToCaseField: 'nextOfKinName',
            },
            {
              key: 'nextOfKinPhone',
              label: 'Next of kin — phone number',
              checklistItemIndex: 7,
              mapsToCaseField: 'nextOfKinPhone',
            },
          ],
        },
      ],
    };

    it('never syncs a legacy combined fieldValues[7] value into nextOfKinName', () => {
      const result = deriveCaseFieldSyncFromFieldValues(
        INTAKE_WITH_FAMILY_CONTACT,
        { 7: 'EMMA MORALES SILVA — (954) 901-4165' },
        new Set(),
      );
      expect(result).toEqual({});
      expect(result.nextOfKinName).toBeUndefined();
      expect(result.nextOfKinPhone).toBeUndefined();
    });

    it('does not sync anything for index 7 regardless of value shape (not just the specific reported case)', () => {
      const result = deriveCaseFieldSyncFromFieldValues(INTAKE_WITH_FAMILY_CONTACT, { 7: 'Some Name — 555-0100' }, new Set());
      expect(result).toEqual({});
    });

    it('an ambiguous index-7 entry never blocks sync of other, unambiguous indices in the same patch', () => {
      const result = deriveCaseFieldSyncFromFieldValues(
        INTAKE_WITH_FAMILY_CONTACT,
        { 3: '178 lb', 5: '14:30', 7: 'Emma Morales Silva — (954) 901-4165' },
        new Set(),
      );
      expect(result).toEqual({ weight: '178 lb', timeOfDeath: '14:30' });
      expect(result.nextOfKinName).toBeUndefined();
    });

    it('single-field sync (Weight) is completely unaffected by the presence of an ambiguous index elsewhere in the template', () => {
      const result = deriveCaseFieldSyncFromFieldValues(INTAKE_WITH_FAMILY_CONTACT, { 3: '178 lb' }, new Set());
      expect(result).toEqual({ weight: '178 lb' });
    });

    it('single-field sync (Time of Death) is completely unaffected by the presence of an ambiguous index elsewhere in the template', () => {
      const result = deriveCaseFieldSyncFromFieldValues(INTAKE_WITH_FAMILY_CONTACT, { 5: '11:30AM' }, new Set());
      expect(result).toEqual({ timeOfDeath: '11:30' });
    });
  });
});
