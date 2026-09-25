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
  fieldMap: '{}',
  linkTokenFieldName: 'solisLinkToken',
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
    expect(url).toContain('3_nameof%5Bfirst%5D=Jane');
    expect(url).toContain('3_nameof%5Blast%5D=Doe');
    expect(url).toContain('10_dateof10=01%2F02%2F1950');
    expect(url).toContain('6_dateof=08%2F15%2F2026');
    expect(url).toContain('22_nextof%5Bfirst%5D=John');
    expect(url).toContain('nextOf39=family%40example.com');
    expect(url).toContain('solisLinkToken=raw-token-abc');
  });

  it('never includes a case-number field — family audience never sees it', () => {
    const url = buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'raw-token-abc');
    expect(url).not.toContain('caseNo');
  });

  it('URL-encodes special characters correctly', () => {
    const url = buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, { ...SAMPLE_VALUES, nextOfKinEmail: 'a+b@example.com' }, 'tok');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('39_nextOf39')).toBe('a+b@example.com');
  });
});

describe('buildJotformPrefillUrl — Arrangement Forms (staff-facing)', () => {
  it('additionally prefills both Case No. fields (qid=1 and qid=198)', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('1_caseNo')).toBe('B2026-034');
    expect(parsed.searchParams.get('198_caseNo198')).toBe('B2026-034');
  });

  it('still carries the hidden link token', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    expect(new URL(url).searchParams.get('solisLinkToken')).toBe('raw-token-xyz');
  });

  describe('Phase A.2 (2026-09) — dedicated NOK fields (qids 277-279)', () => {
    it('H: prefills qids 277-279 when nextOfKinName/Phone/Relationship are available', () => {
      const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
      const parsed = new URL(url);
      expect(parsed.searchParams.get('277_nextOf[first]')).toBe('John');
      expect(parsed.searchParams.get('277_nextOf[last]')).toBe('Doe');
      expect(parsed.searchParams.get('278_nextOf278[full]')).toBe('(555) 123-4567');
      expect(parsed.searchParams.get('279_nextOf279')).toBe('Spouse');
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
      expect(new URL(url).searchParams.get('279_nextOf279')).toBeNull();
    });

    it('omits the dedicated NOK fields entirely when no NOK values are available', () => {
      const url = buildJotformPrefillUrl(
        ARRANGEMENT_FORMS_CONFIG,
        { ...SAMPLE_VALUES, nextOfKinName: null, nextOfKinPhone: null, nextOfKinRelationship: null },
        'raw-token-xyz',
      );
      const parsed = new URL(url);
      expect(parsed.searchParams.get('277_nextOf[first]')).toBeNull();
      expect(parsed.searchParams.get('278_nextOf278[full]')).toBeNull();
      expect(parsed.searchParams.get('279_nextOf279')).toBeNull();
    });

    it('never prefills qids 277-279 for Vital Statistics (form-id gated)', () => {
      const url = buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'raw-token-abc');
      const parsed = new URL(url);
      expect(parsed.searchParams.get('277_nextOf[first]')).toBeNull();
      expect(parsed.searchParams.get('279_nextOf279')).toBeNull();
    });
  });
});

describe('Phase A.2/2026-09 outbound-prefill fix — form-gated decedent-info block', () => {
  it('Z: Vital values only target Vital qids (3/10/6/22/24/39), never Arrangement-only qids', () => {
    const url = buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'raw-token-abc');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('3_nameof[first]')).toBe('Jane');
    expect(parsed.searchParams.get('10_dateof10')).toBe('01/02/1950');
    expect(parsed.searchParams.get('6_dateof')).toBe('08/15/2026');
    expect(parsed.searchParams.get('22_nextof[first]')).toBe('John');
    expect(parsed.searchParams.get('24_nextOf24[full]')).toBe('(555) 123-4567');
    expect(parsed.searchParams.get('39_nextOf39')).toBe('family@example.com');
    // Never the Arrangement-specific decedent-info qids.
    expect(parsed.searchParams.get('87_name87[first]')).toBeNull();
    expect(parsed.searchParams.get('8_dateOf')).toBeNull();
  });

  it('AA: Arrangement values only target Arrangement qids, never the Vital "common" qids', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('87_name87[first]')).toBe('Jane');
    expect(parsed.searchParams.get('87_name87[last]')).toBe('Doe');
    // Never the Vital-Statistics-only qids (3/6/22/24/39 don't exist on
    // Arrangement Forms at all — confirmed against a real submission).
    expect(parsed.searchParams.get('3_nameof[first]')).toBeNull();
    expect(parsed.searchParams.get('6_dateof')).toBeNull();
    expect(parsed.searchParams.get('22_nextof[first]')).toBeNull();
    expect(parsed.searchParams.get('24_nextOf24[full]')).toBeNull();
    expect(parsed.searchParams.get('39_nextOf39')).toBeNull();
  });

  it('AB: Arrangement DOB targets qid 8', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    expect(new URL(url).searchParams.get('8_dateOf')).toBe('01/02/1950');
  });

  it('AC: Arrangement DOD targets qid 10, and Arrangement DOB never targets qid 10', () => {
    const url = buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('10_dateOf10')).toBe('08/15/2026');
    // qid 10 on Arrangement is Date of Death — DOB (01/02/1950) must
    // never appear there.
    expect(parsed.searchParams.get('10_dateOf10')).not.toBe('01/02/1950');
    expect(parsed.searchParams.get('10_dateof10')).toBeNull(); // the Vital-only lowercase key, never set for Arrangement
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
    const arrangementUrl = new URL(buildJotformPrefillUrl(ARRANGEMENT_FORMS_CONFIG, SAMPLE_VALUES, 'raw-token-xyz'));
    const vitalOnlyKeyPrefixes = ['3_nameof', '6_dateof', '22_nextof', '24_nextOf24', '39_nextOf39'];
    for (const key of arrangementUrl.searchParams.keys()) {
      expect(vitalOnlyKeyPrefixes.some((p) => key.startsWith(p))).toBe(false);
    }

    const vitalUrl = new URL(buildJotformPrefillUrl(VITAL_STATISTICS_CONFIG, SAMPLE_VALUES, 'raw-token-abc'));
    const arrangementOnlyKeyPrefixes = ['87_name87', '8_dateOf', '10_dateOf10', '277_nextOf', '278_nextOf278', '279_nextOf279'];
    for (const key of vitalUrl.searchParams.keys()) {
      expect(arrangementOnlyKeyPrefixes.some((p) => key.startsWith(p))).toBe(false);
    }
  });
});
