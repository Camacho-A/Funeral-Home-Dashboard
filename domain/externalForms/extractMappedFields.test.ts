import { describe, expect, it } from 'vitest';
import { extractMappedFields } from './extractMappedFields';
import { FIELD_MAP_VITAL_STATISTICS, FIELD_MAP_ARRANGEMENT_FORMS } from './fieldMapping';

describe('extractMappedFields — Vital Statistics (synthetic fixture, no real submission data)', () => {
  it('combines compound fullname subfields into one Solis-shaped name', () => {
    const answers = {
      '3': { answer: { first: 'John', last: 'Doe' } },
    };
    const result = extractMappedFields(FIELD_MAP_VITAL_STATISTICS, answers);
    expect(result.decedentName).toBe('John Doe');
  });

  it('extracts a simple date field directly', () => {
    const answers = { '6': { answer: '08/15/2026' } };
    const result = extractMappedFields(FIELD_MAP_VITAL_STATISTICS, answers);
    expect(result.dateOfDeath).toBe('08/15/2026');
  });

  it('applies a valueMap for isVeteran (YES/NO -> true/false)', () => {
    const answers = { '12': { answer: 'YES' } };
    const result = extractMappedFields(FIELD_MAP_VITAL_STATISTICS, answers);
    expect(result.isVeteran).toBe('true');
  });

  it('remaps Mother/Father NOK-relationship dropdown values onto the generic "parent" enum value', () => {
    const motherAnswers = { '38': { answer: 'Mother' } };
    const fatherAnswers = { '38': { answer: 'Father' } };
    expect(extractMappedFields(FIELD_MAP_VITAL_STATISTICS, motherAnswers).nextOfKinRelationship).toBe('parent');
    expect(extractMappedFields(FIELD_MAP_VITAL_STATISTICS, fatherAnswers).nextOfKinRelationship).toBe('parent');
  });

  it('extracts a compound phone field via its "full" subfield', () => {
    const answers = { '24': { answer: { full: '(555) 123-4567' } } };
    const result = extractMappedFields(FIELD_MAP_VITAL_STATISTICS, answers);
    expect(result.nextOfKinPhone).toBe('(555) 123-4567');
  });

  it('never maps SSN — no entry exists in the field map for it at all', () => {
    const result = extractMappedFields(FIELD_MAP_VITAL_STATISTICS, { '7': { answer: 'not-a-real-ssn' } });
    expect(Object.keys(result)).not.toContain('ssn');
    expect(FIELD_MAP_VITAL_STATISTICS.some((e) => e.qid === '7')).toBe(false);
  });

  it('omits a field entirely when its answer is absent', () => {
    const result = extractMappedFields(FIELD_MAP_VITAL_STATISTICS, {});
    expect(result.decedentName).toBeUndefined();
    expect(result.dateOfBirth).toBeUndefined();
  });
});

describe('extractMappedFields — Arrangement Forms', () => {
  it('maps "Release Cremated Remains to:" onto pickupReleasedTo', () => {
    const answers = { '174': { answer: { first: 'Mary', last: 'Smith' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.pickupReleasedTo).toBe('Mary Smith');
  });

  it('captures the release relationship as review-only data, not a Case field', () => {
    const answers = { '175': { answer: 'Daughter' } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.pickupReleaseRelationship).toBe('Daughter');
  });

  it('never maps race/education/employment/parents-name fields — no entries exist for them', () => {
    const mappedQids = new Set(FIELD_MAP_ARRANGEMENT_FORMS.map((e) => e.qid));
    // qid=108 (race), qid=113 (education), qid=25/26 (occupation/business), qid=118/120 (parents' names)
    for (const excludedQid of ['108', '113', '25', '26', '118', '120']) {
      expect(mappedQids.has(excludedQid)).toBe(false);
    }
  });

  it('Informant fields (2026-09 historical-case-creation audit) map correctly, review-only — informantName/informantPhone/informantRelationship', () => {
    const answers = {
      '122': { answer: { first: 'Pat', last: 'Rivera' } },
      '224': { answer: { full: '(555) 200-3000' } },
      '225': { answer: 'Spouse' },
    };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.informantName).toBe('Pat Rivera');
    expect(result.informantPhone).toBe('(555) 200-3000');
    expect(result.informantRelationship).toBe('Spouse');
  });

  it('Informant relationship is never remapped through NOK_RELATIONSHIP_VALUE_MAP — raw Jotform option text is preserved as-is', () => {
    const answers = { '225': { answer: 'Mother' } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    // NOK_RELATIONSHIP_VALUE_MAP would remap "Mother" -> "parent"; Informant
    // has no such remapping, so the raw text must survive unchanged.
    expect(result.informantRelationship).toBe('Mother');
  });

  it('Informant fields never populate nextOfKinName/nextOfKinPhone/nextOfKinRelationship — no code path conflates the two', () => {
    const answers = {
      '122': { answer: { first: 'Pat', last: 'Rivera' } },
      '224': { answer: { full: '(555) 200-3000' } },
      '225': { answer: 'Spouse' },
    };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.nextOfKinName).toBeUndefined();
    expect(result.nextOfKinPhone).toBeUndefined();
    expect(result.nextOfKinRelationship).toBeUndefined();
  });

  it('data minimization (2026-09): a synthetic SSN/signature-like answer is never surfaced in mappedFields, even when present in the raw answer map — because no FieldMapEntry references those qids at all', () => {
    // Synthetic fixture only — these qids are illustrative stand-ins for
    // the real (excluded) SSN/signature question ids, never real values.
    const answers = {
      '174': { answer: { first: 'Mary', last: 'Smith' } },
      '900': { answer: 'synthetic-ssn-000-00-0000' },
      '901': { answer: 'synthetic-signature-blob-data' },
    };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('synthetic-ssn-000-00-0000');
    expect(serialized).not.toContain('synthetic-signature-blob-data');
    expect(result.pickupReleasedTo).toBe('Mary Smith');
  });
});

describe('extractMappedFields — compound date extraction (2026-09 historical-import fix, synthetic fixtures only)', () => {
  it('A: a valid compound DOB (qid 8, Arrangement) is combined into MM/DD/YYYY', () => {
    const answers = { '8': { answer: { month: '10', day: '26', year: '1945', datetime: '1945-10-26 00:00:00' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.dateOfBirth).toBe('10/26/1945');
  });

  it('B: a valid compound DOD (qid 10, Arrangement) is combined into MM/DD/YYYY', () => {
    const answers = { '10': { answer: { month: '9', day: '3', year: '2026', datetime: '2026-09-03 00:00:00' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.dateOfDeath).toBe('09/03/2026');
  });

  it('C: an invalid calendar date (day=32) is rejected, never silently rolled over', () => {
    const answers = { '8': { answer: { month: '1', day: '32', year: '2000' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.dateOfBirth).toBeUndefined();
  });

  it('C2: Feb 30 (a real-looking but impossible date) is rejected', () => {
    const answers = { '8': { answer: { month: '2', day: '30', year: '2000' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.dateOfBirth).toBeUndefined();
  });

  it('D: an incomplete compound date (missing year) is rejected, never guessed', () => {
    const answers = { '8': { answer: { month: '10', day: '26' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.dateOfBirth).toBeUndefined();
  });

  it('E: a genuinely plain-string date answer still works (legacy/unconfirmed-shape fallback preserved)', () => {
    const answers = { '6': { answer: '08/15/2026' } };
    const result = extractMappedFields(FIELD_MAP_VITAL_STATISTICS, answers);
    expect(result.dateOfDeath).toBe('08/15/2026');
  });

  it('a non-numeric compound date component is rejected', () => {
    const answers = { '8': { answer: { month: 'October', day: '26', year: '1945' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.dateOfBirth).toBeUndefined();
  });

  it('the same combiner correctly handles Vital Statistics compound dates too (qid 10 = DOB there)', () => {
    const answers = { '10': { answer: { month: '3', day: '7', year: '1960' } } };
    const result = extractMappedFields(FIELD_MAP_VITAL_STATISTICS, answers);
    expect(result.dateOfBirth).toBe('03/07/1960');
  });
});

describe('extractMappedFields — compound Place of Death extraction (2026-09 historical-import fix, synthetic fixtures only)', () => {
  it('F: prefers addr_line1 when non-empty', () => {
    const answers = { '97': { answer: { addr_line1: 'BROWARD HEALTH MEDICAL CENTER', city: 'Fort Lauderdale', state: 'FL' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.placeOfDeath).toBe('BROWARD HEALTH MEDICAL CENTER');
  });

  it('G: falls back to city + state when addr_line1 is blank', () => {
    const answers = { '97': { answer: { addr_line1: '', city: 'Fort Lauderdale', state: 'FL' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.placeOfDeath).toBe('Fort Lauderdale, FL');
  });

  it('H: an entirely empty compound address yields no placeOfDeath, never a full mailing address', () => {
    const answers = { '97': { answer: { addr_line1: '', addr_line2: '', city: '', state: '', postal: '', country: '' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.placeOfDeath).toBeUndefined();
  });

  it('never emits a full multi-line address — only addr_line1 or city/state, never postal/country', () => {
    const answers = { '97': { answer: { addr_line1: 'ST. MARY\'S HOSPITAL', city: 'Fort Lauderdale', state: 'FL', postal: '33311', country: 'United States' } } };
    const result = extractMappedFields(FIELD_MAP_ARRANGEMENT_FORMS, answers);
    expect(result.placeOfDeath).toBe('ST. MARY\'S HOSPITAL');
    expect(result.placeOfDeath).not.toContain('33311');
  });

  it('a genuinely plain-string placeOfDeath answer still works (Vital Statistics, unconfirmed shape, fallback preserved)', () => {
    const answers = { '30': { answer: 'ST. MARY\'S HOSPITAL' } };
    const result = extractMappedFields(FIELD_MAP_VITAL_STATISTICS, answers);
    expect(result.placeOfDeath).toBe('ST. MARY\'S HOSPITAL');
  });
});
