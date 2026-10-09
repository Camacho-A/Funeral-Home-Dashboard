import { describe, expect, it } from 'vitest';
import { buildJotformPrefillUrl } from './prefillUrl';
import type { ExternalFormConfig } from '@/types/externalFormConfig';

const VITAL_STATISTICS_CONFIG: ExternalFormConfig = {
  id: 'config-vs',
  organizationId: 'org-1',
  provider: 'jotform',
  externalFormId: '262605621454050',
  label: 'Vital Statistics',
  audience: 'family',
  purpose: 'case_update',
  fieldMap: '{}',
  // The field's real Jotform NAME on the live form — what URL prefill
  // keys on. Lowercased by Jotform, unlike its display name.
  linkTokenFieldName: 'solislinktoken',
  linkTokenFieldQid: '44',
  webhookAuthFieldQid: '45',
  isEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ARRANGEMENT_FORMS_CONFIG: ExternalFormConfig = {
  ...VITAL_STATISTICS_CONFIG,
  id: 'config-af',
  externalFormId: '261945978664175',
  label: 'Arrangement Forms',
  audience: 'staff',
  purpose: 'case_update',
  // Arrangement's hidden token field is named `input274` on the live
  // form — an auto-generated placeholder, nothing like its display name.
  linkTokenFieldName: 'input274',
  linkTokenFieldQid: '274',
  webhookAuthFieldQid: '275',
};

const SAMPLE_VALUES = {
  caseNumber: 'B2026-034',
  decedentName: 'Jane Doe',
  dateOfBirth: '01/02/1950',
  dateOfDeath: '08/15/2026',
  nextOfKinName: 'John Doe',
  nextOfKinPhone: '(555) 123-4567',
  nextOfKinEmail: 'family@example.com',
  nextOfKinRelationship: 'spouse' as const,
};

describe('buildJotformPrefillUrl — Vital Statistics (family-facing)', () => {
  it('prefills decedent name, DOB, DOD, NOK name/phone/email, and the hidden link token', () => {
    const url = buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'raw-token-abc');
    expect(url).toContain('nameof%5Bfirst%5D=Jane');
    expect(url).toContain('nameof%5Blast%5D=Doe');
    // Compound control_datetime fields take month/day/year subfields —
    // a single MM/DD/YYYY string only ever filled the month (live-verified).
    expect(url).toContain('dateof10%5Bmonth%5D=01');
    expect(url).toContain('dateof10%5Bday%5D=02');
    expect(url).toContain('dateof10%5Byear%5D=1950');
    expect(url).toContain('dateof%5Bmonth%5D=08');
    expect(url).toContain('nextof%5Bfirst%5D=John');
    expect(url).toContain('nextOf39=family%40example.com');
    expect(url).toContain('solislinktoken=raw-token-abc');
  });

  it('never includes a case-number field — family audience never sees it', () => {
    const url = buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'raw-token-abc');
    expect(url).not.toContain('caseNo');
  });

  it('URL-encodes special characters correctly', () => {
    const url = buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, { ...SAMPLE_VALUES, nextOfKinEmail: 'a+b@example.com' }, 'tok');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('nextOf39')).toBe('a+b@example.com');
  });
});

describe('buildJotformPrefillUrl — Arrangement Forms (staff-facing)', () => {
  it('additionally prefills both Case No. fields (qid=1 and qid=198)', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('caseNo')).toBe('B2026-034');
    expect(parsed.searchParams.get('caseNo198')).toBe('B2026-034');
  });

  it('still carries the hidden link token', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    expect(new URL(url).searchParams.get('input274')).toBe('raw-token-xyz');
  });

  describe('Phase A.2 (2026-09) — dedicated NOK fields (qids 277-279)', () => {
    it('H: prefills qids 277-279 when nextOfKinName/Phone/Relationship are available', () => {
      const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
      const parsed = new URL(url);
      expect(parsed.searchParams.get('nextOf[first]')).toBe('John');
      expect(parsed.searchParams.get('nextOf[last]')).toBe('Doe');
      expect(parsed.searchParams.get('nextOf278[full]')).toBe('(555) 123-4567');
      expect(parsed.searchParams.get('nextOf279')).toBe('Spouse');
    });

    it('I: NEVER prefills qid 276 — the human must explicitly answer it every time', () => {
      const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
      const parsed = new URL(url);
      for (const key of parsed.searchParams.keys()) {
        expect(key.startsWith('276_')).toBe(false);
      }
      expect(url).not.toContain('isThe');
    });

    it('omits qid 279 for an ambiguous enum value (parent/grandchild) rather than guessing', () => {
      const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, { ...SAMPLE_VALUES, nextOfKinRelationship: 'parent' }, 'raw-token-xyz');
      expect(new URL(url).searchParams.get('nextOf279')).toBeNull();
    });

    it('omits the dedicated NOK fields entirely when no NOK values are available', () => {
      const url = buildJotformPrefillUrl(
        ARRANGEMENT_FORMS_CONFIG,
        { ...SAMPLE_VALUES, nextOfKinName: null, nextOfKinPhone: null, nextOfKinRelationship: null },
        'raw-token-xyz',
      );
      const parsed = new URL(url);
      expect(parsed.searchParams.get('nextOf[first]')).toBeNull();
      expect(parsed.searchParams.get('nextOf278[full]')).toBeNull();
      expect(parsed.searchParams.get('nextOf279')).toBeNull();
    });

    it('never prefills qids 277-279 for Vital Statistics (form-id gated)', () => {
      const url = buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'raw-token-abc');
      const parsed = new URL(url);
      expect(parsed.searchParams.get('nextOf[first]')).toBeNull();
      expect(parsed.searchParams.get('nextOf279')).toBeNull();
    });
  });
});

describe('Phase A.2/2026-09 outbound-prefill fix — form-gated decedent-info block', () => {
  it('Z: Vital values only target Vital qids (3/10/6/22/24/39), never Arrangement-only qids', () => {
    const url = buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'raw-token-abc');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('nameof[first]')).toBe('Jane');
    expect(parsed.searchParams.get('dateof10[year]')).toBe('1950');
    expect(parsed.searchParams.get('dateof[year]')).toBe('2026');
    expect(parsed.searchParams.get('nextof[first]')).toBe('John');
    expect(parsed.searchParams.get('nextOf24[full]')).toBe('(555) 123-4567');
    expect(parsed.searchParams.get('nextOf39')).toBe('family@example.com');
    // Never the Arrangement-specific decedent-info qids.
    expect(parsed.searchParams.get('name87[first]')).toBeNull();
    expect(parsed.searchParams.get('dateOf[month]')).toBeNull();
  });

  it('AA: Arrangement values only target Arrangement qids, never the Vital "common" qids', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('name87[first]')).toBe('Jane');
    expect(parsed.searchParams.get('name87[last]')).toBe('Doe');
    // Never the Vital-Statistics-only qids (3/6/22/24/39 don't exist on
    // Arrangement Forms at all — confirmed against a real submission).
    expect(parsed.searchParams.get('nameof[first]')).toBeNull();
    expect(parsed.searchParams.get('dateof[month]')).toBeNull();
    expect(parsed.searchParams.get('nextof[first]')).toBeNull();
    expect(parsed.searchParams.get('nextOf24[full]')).toBeNull();
    expect(parsed.searchParams.get('nextOf39')).toBeNull();
  });

  it('AB: Arrangement DOB targets qid 8', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    const p8 = new URL(url).searchParams;
    expect(p8.get('dateOf[month]')).toBe('01');
    expect(p8.get('dateOf[day]')).toBe('02');
    expect(p8.get('dateOf[year]')).toBe('1950');
  });

  it('AC: Arrangement DOD targets qid 10, and Arrangement DOB never targets qid 10', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('dateOf10[month]')).toBe('08');
    expect(parsed.searchParams.get('dateOf10[year]')).toBe('2026');
    // qid 10 on Arrangement is Date of Death — DOB (01/02/1950) must
    // never appear there.
    expect(parsed.searchParams.get('dateOf10')).not.toBe('01/02/1950');
    expect(parsed.searchParams.get('dateof10')).toBeNull(); // the Vital-only lowercase key, never set for Arrangement
  });

  it('AD: qid 276 is never prefilled for Arrangement Forms (re-asserted alongside the new decedent-info block)', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    const parsed = new URL(url);
    for (const key of parsed.searchParams.keys()) {
      expect(key.startsWith('276_')).toBe(false);
    }
    expect(url).not.toContain('isThe');
  });

  it('AE: no cross-form qid leakage — a full Arrangement link never contains any Vital-only param key, and vice versa', () => {
    // Compared as EXACT keys, not prefixes. Prefill keys are the fields'
    // own Jotform names (2026-10 live-verified convention), and those
    // overlap across forms by prefix — Vital's `nextOf24[full]` and
    // Arrangement's `nextOf[first]` share a stem while being different
    // fields on different forms. Exact keys are both correct and stricter.
    const VITAL_ONLY_KEYS = [
      'nameof[first]',
      'nameof[last]',
      'dateof10[year]',
      'dateof[year]',
      'nextof[first]',
      'nextof[last]',
      'nextOf24[full]',
      'nextOf39',
    ];
    const ARRANGEMENT_ONLY_KEYS = [
      'name87[first]',
      'name87[last]',
      'dateOf[year]',
      'dateOf10[year]',
      'nextOf[first]',
      'nextOf[last]',
      'nextOf278[full]',
      'nextOf279',
    ];

    const arrangementKeys = [...new URL(buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz')).searchParams.keys()];
    for (const key of VITAL_ONLY_KEYS) {
      expect(arrangementKeys, `Arrangement link must not carry Vital-only key ${key}`).not.toContain(key);
    }

    const vitalKeys = [...new URL(buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'raw-token-abc')).searchParams.keys()];
    for (const key of ARRANGEMENT_ONLY_KEYS) {
      expect(vitalKeys, `Vital link must not carry Arrangement-only key ${key}`).not.toContain(key);
    }
  });
});

/**
 * Live-verified prefill convention (2026-10). Jotform keys URL prefill on
 * a field's own NAME. The previous `{qid}_{name}` form was silently
 * ignored, which meant every generated link — including its case link
 * token — arrived blank. These pin the corrected convention.
 */
describe('buildJotformPrefillUrl — live-verified parameter convention', () => {
  it('never emits a qid-prefixed key for any parameter', () => {
    for (const config of [VITAL_STATISTICS_CONFIG, ARRANGEMENT_FORMS_CONFIG]) {
      const url = new URL(buildJotformPrefillUrl(config, SAMPLE_VALUES, 'tok'));
      for (const key of url.searchParams.keys()) {
        expect(key, `"${key}" must not be qid-prefixed`).not.toMatch(/^q?\d+_/);
      }
    }
  });

  it('carries the link token under the hidden field\'s real Jotform name, per form', () => {
    expect(new URL(buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'tok-a')).searchParams.get('input274')).toBe('tok-a');
    expect(new URL(buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'tok-v')).searchParams.get('solislinktoken')).toBe('tok-v');
  });

  it('splits a compound datetime into month/day/year subfields', () => {
    const p = new URL(buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'tok')).searchParams;
    expect([p.get('dateOf[month]'), p.get('dateOf[day]'), p.get('dateOf[year]')]).toEqual(['01', '02', '1950']);
  });

  it('skips a malformed or missing date entirely rather than half-filling it', () => {
    for (const dateOfBirth of ['1950-01-02', '1/2/1950', 'unknown', '—', '', null]) {
      const p = new URL(
        buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, { ...SAMPLE_VALUES, dateOfBirth }, 'tok'),
      ).searchParams;
      expect(p.get('dateOf[month]'), `${dateOfBirth} must not partially fill`).toBeNull();
      expect(p.get('dateOf[day]')).toBeNull();
      expect(p.get('dateOf[year]')).toBeNull();
    }
  });

  it('omits the link token parameter entirely for a config with no token field name', () => {
    const noName = { ...ARRANGEMENT_FORMS_CONFIG, linkTokenFieldName: '' };
    const url = new URL(buildJotformPrefillUrl(noName, SAMPLE_VALUES, 'tok'));
    expect(url.searchParams.get('')).toBeNull();
  });
});
