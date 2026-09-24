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
};

const SAMPLE_VALUES = {
  caseNumber: 'B2026-034',
  decedentName: 'Jane Doe',
  dateOfBirth: '01/02/1950',
  dateOfDeath: '08/15/2026',
  nextOfKinName: 'John Doe',
  nextOfKinPhone: '(555) 123-4567',
  nextOfKinEmail: 'family@example.com',
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
});
