import { describe, expect, it } from 'vitest';
import { FaxConfigurationError, normalizeDestinationName, normalizeDestinationPurpose, normalizeFaxNumber } from './faxConfiguration';
import { FaxTemplateError, defaultSubjectTemplate, renderFaxTemplate, validateBodyTemplate, validateSubjectTemplate } from './faxTemplates';
import { FAX_PROVIDERS, canUse, faxProvider, isFaxProviderKey, nusoIpFaxProvider } from './faxProviders';
import { GATEWAY_DOMAINS } from './faxSettings';

/** Fax Settings (2026-11): pure validation. Fictional numbers only. */
describe('fax numbers', () => {
  it.each([
    ['941-554-5490', '9415545490'],
    ['(941) 554-5490', '9415545490'],
    ['941.554.5490', '9415545490'],
    ['+1 941 554 5490', '9415545490'],
    ['1-305-555-0100', '3055550100'],
  ])('%s → %s', (input, expected) => expect(normalizeFaxNumber(input)).toBe(expected));

  it.each(['', '   ', '554-5490', '941-554-549', '94155454900', '+44 20 7946 0958', '041-554-5490', '941-054-5490', '941-554-5490 x2', 'fax: 9415545490', null, 9415545490])('refuses %s', (input) => {
    expect(() => normalizeFaxNumber(input)).toThrow(FaxConfigurationError);
  });

  it('names and purposes are plain, trimmed and bounded', () => {
    expect(normalizeDestinationName('  Manatee   County  ')).toBe('Manatee County');
    expect(() => normalizeDestinationName('')).toThrow(/required/);
    expect(() => normalizeDestinationName('x'.repeat(101))).toThrow(/at most 100/);
    expect(() => normalizeDestinationName('<script>')).toThrow(/plain text/);
    expect(normalizeDestinationPurpose(undefined)).toBe('');
    expect(() => normalizeDestinationPurpose('a\u0007b')).toThrow(/plain text/);
  });
});

describe('templates', () => {
  it('the default subject is exactly the one sent before Fax Settings', () => {
    expect(renderFaxTemplate(defaultSubjectTemplate('Manors Cremation'), { reference: 'DC-7Q4K9M', organizationName: 'x', applicationCount: 1, pageCount: 1 })).toBe('Manors Cremation - DC Application Bundle DC-7Q4K9M');
  });

  it('renders every allowed placeholder', () => {
    const template = validateSubjectTemplate('{organizationName}: {applicationCount} applications, {pageCount} pages — {reference}');
    expect(renderFaxTemplate(template, { reference: 'DC-AAAAAA', organizationName: 'Manors Cremation', applicationCount: 3, pageCount: 4 })).toBe('Manors Cremation: 3 applications, 4 pages — DC-AAAAAA');
  });

  it.each([
    ['{decedentName} {reference}', /never include decedent/],
    ['{firstName} {reference}', /never include decedent/],
    ['{ssn} {reference}', /never include decedent/],
    ['{caseNumber} {reference}', /never include decedent/],
    ['{familyEmail} {reference}', /never include decedent/],
    ['{ reference }', /not a placeholder/],
    ['{Reference}', /not a placeholder/],
    ['{reference}}', /unmatched/],
    ['Subject\r\nBcc: someone@example.com {reference}', /single line/],
    ['Tab\there {reference}', /single line/],
    ['No placeholder', /must include \{reference\}/],
  ])('refuses the subject %j', (template, message) => {
    expect(() => validateSubjectTemplate(template)).toThrow(message);
  });

  it('the message is plain text: CRLF normalised, HTML and decedent placeholders refused, empty allowed', () => {
    expect(validateBodyTemplate(undefined)).toBe('');
    expect(validateBodyTemplate('  ')).toBe('');
    expect(validateBodyTemplate('Line one  \r\nLine two\r')).toBe('Line one\nLine two');
    expect(() => validateBodyTemplate('<p>Hello</p>')).toThrow(FaxTemplateError);
    expect(() => validateBodyTemplate('For {decedentName}')).toThrow(/never include decedent/);
    expect(() => validateBodyTemplate('x'.repeat(2001))).toThrow(/at most 2000/);
    expect(() => validateBodyTemplate(42)).toThrow(/plain text/);
  });
});

describe('providers', () => {
  it('NuSo: its gateway is approved; a message is unverified and a cover page unsupported — neither can be used', () => {
    expect(nusoIpFaxProvider.gatewayDomain).toBe('fax.nuso.io');
    expect(GATEWAY_DOMAINS).toContain(nusoIpFaxProvider.gatewayDomain);
    expect(nusoIpFaxProvider).toMatchObject({ emailBody: 'unverified', coverPage: 'unsupported' });
    expect(canUse(nusoIpFaxProvider.emailBody)).toBe(false);
    expect(canUse(nusoIpFaxProvider.coverPage)).toBe(false);
    expect(canUse('supported')).toBe(true);
  });

  it('only registered providers with an approved gateway resolve', () => {
    expect(faxProvider('nuso')).toBe(nusoIpFaxProvider);
    for (const key of ['', 'NUSO', 'toString', '__proto__', 'constructor', null, 1]) {
      expect(isFaxProviderKey(key)).toBe(false);
      expect(faxProvider(key)).toBeNull();
    }
    for (const p of Object.values(FAX_PROVIDERS)) expect(GATEWAY_DOMAINS).toContain(p.gatewayDomain);
  });
});
