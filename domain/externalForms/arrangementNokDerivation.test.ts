import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { deriveArrangementNextOfKin, extractArrangementFormsMappedFields, extractMappedFieldsForForm } from './arrangementNokDerivation';
import { FIELD_MAP_ARRANGEMENT_FORMS } from './fieldMapping';

// Synthetic fixtures only — no real family/decedent data anywhere in this file.

describe('deriveArrangementNextOfKin', () => {
  const informant = { informantName: 'Pat Rivera', informantPhone: '(555) 200-3000', informantRelationship: 'Spouse' };

  it('A: Yes + Informant populated + 277-279 absent -> NOK derives from Informant', () => {
    const answers = { '276': { answer: 'Yes' } };
    const result = deriveArrangementNextOfKin(answers, informant);
    expect(result.nextOfKinName).toBe('Pat Rivera');
    expect(result.nextOfKinPhone).toBe('(555) 200-3000');
    expect(result.nextOfKinRelationship).toBe('spouse');
    expect(result.informantIsNextOfKin).toBe('Yes');
  });

  it('B: Yes + Informant populated + 277-279 contain DIFFERENT stale values -> stale values ignored completely, NOK still derives from Informant', () => {
    const answers = {
      '276': { answer: 'Yes' },
      '277': { answer: { first: 'Stale', last: 'Person' } },
      '278': { answer: { full: '(555) 999-0000' } },
      '279': { answer: 'Brother' },
    };
    const result = deriveArrangementNextOfKin(answers, informant);
    expect(result.nextOfKinName).toBe('Pat Rivera');
    expect(result.nextOfKinPhone).toBe('(555) 200-3000');
    expect(result.nextOfKinRelationship).toBe('spouse');
    expect(result.nextOfKinName).not.toContain('Stale');
  });

  it('C: No + Informant populated + 277-279 populated -> NOK comes exclusively from 277-279', () => {
    const answers = {
      '276': { answer: 'No' },
      '277': { answer: { first: 'Jordan', last: 'Lee' } },
      '278': { answer: { full: '(555) 444-1111' } },
      '279': { answer: 'Sister' },
    };
    const result = deriveArrangementNextOfKin(answers, informant);
    expect(result.nextOfKinName).toBe('Jordan Lee');
    expect(result.nextOfKinPhone).toBe('(555) 444-1111');
    expect(result.nextOfKinRelationship).toBe('sister');
  });

  it('D: No + dedicated NOK missing -> Informant is NOT substituted', () => {
    const answers = { '276': { answer: 'No' } };
    const result = deriveArrangementNextOfKin(answers, informant);
    expect(result.nextOfKinName).toBeUndefined();
    expect(result.nextOfKinPhone).toBeUndefined();
    expect(result.nextOfKinRelationship).toBeUndefined();
  });

  it('E: 276 missing + Informant populated + dedicated NOK populated -> Informant is NOT automatically treated as NOK', () => {
    const answers = {
      '277': { answer: { first: 'Jordan', last: 'Lee' } },
      '278': { answer: { full: '(555) 444-1111' } },
      '279': { answer: 'Sister' },
    };
    const result = deriveArrangementNextOfKin(answers, informant);
    expect(result.nextOfKinName).toBeUndefined();
    expect(result.nextOfKinPhone).toBeUndefined();
    expect(result.nextOfKinRelationship).toBeUndefined();
    expect(result.informantIsNextOfKin).toBeUndefined();
  });

  it('F: 276 malformed/unrecognized -> fail safe, no Informant->NOK derivation, no dedicated-field trust either', () => {
    const answers = {
      '276': { answer: 'Maybe' },
      '277': { answer: { first: 'Jordan', last: 'Lee' } },
    };
    const result = deriveArrangementNextOfKin(answers, informant);
    expect(result.nextOfKinName).toBeUndefined();
    expect(result.nextOfKinPhone).toBeUndefined();
    expect(result.nextOfKinRelationship).toBeUndefined();
    // The raw malformed value is still surfaced for review/audit.
    expect(result.informantIsNextOfKin).toBe('Maybe');
  });

  it('G: Relationship = Other -> preserved according to existing relationship handling (maps to the real "other" enum value, not dropped)', () => {
    const yesAnswers = { '276': { answer: 'Yes' } };
    const yesResult = deriveArrangementNextOfKin(yesAnswers, { ...informant, informantRelationship: 'Other' });
    expect(yesResult.nextOfKinRelationship).toBe('other');

    const noAnswers = { '276': { answer: 'No' }, '277': { answer: { first: 'A', last: 'B' } }, '279': { answer: 'Other' } };
    const noResult = deriveArrangementNextOfKin(noAnswers, informant);
    expect(noResult.nextOfKinRelationship).toBe('other');
  });

  it('an unmapped relationship option (not in ARRANGEMENT_NOK_RELATIONSHIP_VALUE_MAP) is dropped, never guessed — same behavior as the existing NOK_RELATIONSHIP_VALUE_MAP miss case', () => {
    const answers = { '276': { answer: 'No' }, '277': { answer: { first: 'A', last: 'B' } }, '279': { answer: 'Cousin' } };
    const result = deriveArrangementNextOfKin(answers, informant);
    expect(result.nextOfKinName).toBe('A B');
    expect(result.nextOfKinRelationship).toBeUndefined();
  });
});

describe('extractArrangementFormsMappedFields', () => {
  it('J: Informant fields remain review-only regardless of the NOK branch answer', () => {
    const answers = {
      '122': { answer: { first: 'Pat', last: 'Rivera' } },
      '224': { answer: { full: '(555) 200-3000' } },
      '225': { answer: 'Spouse' },
      '276': { answer: 'No' },
      '277': { answer: { first: 'Jordan', last: 'Lee' } },
      '278': { answer: { full: '(555) 444-1111' } },
      '279': { answer: 'Sister' },
    };
    const result = extractArrangementFormsMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.informantName).toBe('Pat Rivera');
    expect(result.informantPhone).toBe('(555) 200-3000');
    expect(result.informantRelationship).toBe('Spouse');
    // And NOK still came exclusively from the dedicated fields.
    expect(result.nextOfKinName).toBe('Jordan Lee');
  });

  it('overrides a stale fieldMap-driven nextOfKinName with the Yes-path Informant derivation (there is no such fieldMap entry today, but this guards against one being added without updating the derivation)', () => {
    const answers = {
      '122': { answer: { first: 'Pat', last: 'Rivera' } },
      '276': { answer: 'Yes' },
    };
    const result = extractArrangementFormsMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.nextOfKinName).toBe('Pat Rivera');
  });

  it('other existing Arrangement mappings (pickupReleasedTo etc.) are untouched by the NOK derivation', () => {
    const answers = { '174': { answer: { first: 'Mary', last: 'Smith' } } };
    const result = extractArrangementFormsMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.pickupReleasedTo).toBe('Mary Smith');
  });
});

describe('extractMappedFieldsForForm', () => {
  it('routes Arrangement Forms through the NOK-derivation-aware path', () => {
    const answers = { '276': { answer: 'Yes' }, '122': { answer: { first: 'Pat', last: 'Rivera' } } };
    const result = extractMappedFieldsForForm('jotform', '261945978664175', answers);
    expect(result.nextOfKinName).toBe('Pat Rivera');
  });

  it('K: Vital Statistics mapping remains unaffected — routes through the ordinary extractMappedFields, no derivation applied, qid 276 is meaningless on this form', () => {
    const answers = { '22': { answer: { first: 'John', last: 'Doe' } }, '276': { answer: 'Yes' } };
    const result = extractMappedFieldsForForm('jotform', '262605621454050', answers);
    // qid 276 on THIS form is just an ordinary, unmapped question (if it
    // even exists) — it must never be interpreted as the Arrangement
    // Forms NOK branch answer, and nextOfKinName must come from Vital
    // Statistics' own qid 22 mapping exactly as before.
    expect(result.nextOfKinName).toBe('John Doe');
    expect(result.informantIsNextOfKin).toBeUndefined();
  });

  it('an unrecognized provider/form falls through to the base (empty) field map, unaffected', () => {
    const result = extractMappedFieldsForForm('other-provider', '261945978664175', { '276': { answer: 'Yes' } });
    expect(result).toEqual({});
  });
});

describe('M: every mappedFields consumer uses the shared NOK-derivation-aware pipeline (never a bypass)', () => {
  const CONSUMER_FILES = [
    'app/api/webhooks/jotform/route.ts',
    'app/api/cases/[caseId]/forms/[formConfigId]/import-submission/route.ts',
    'app/api/cases/historical-jotform-import/route.ts',
  ];

  function readFile(relativePath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  }

  for (const relativePath of CONSUMER_FILES) {
    it(`${relativePath} imports extractMappedFieldsForForm rather than calling extractMappedFields directly`, () => {
      const code = readFile(relativePath);
      expect(code).toContain("from '@/domain/externalForms/arrangementNokDerivation'");
      expect(code).toContain('extractMappedFieldsForForm(');
      // Never a raw bare extractMappedFields(...) call that would bypass
      // the Arrangement Forms NOK derivation for one of the two importers
      // but not the other.
      expect(code).not.toMatch(/[^.]\bextractMappedFields\(/);
    });
  }
});
