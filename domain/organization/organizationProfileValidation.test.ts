import { describe, expect, it } from 'vitest';
import { validateOrganizationProfileUpdate, validatePrimaryLocationUpdate, isValidWebsiteUrl } from './organizationProfileValidation';

describe('validateOrganizationProfileUpdate', () => {
  it('1. required: rejects a missing/empty name', () => {
    expect(validateOrganizationProfileUpdate({})).toContainEqual(expect.objectContaining({ field: 'name' }));
    expect(validateOrganizationProfileUpdate({ name: '   ' })).toContainEqual(expect.objectContaining({ field: 'name' }));
  });

  it('rejects a name over the max length', () => {
    const errors = validateOrganizationProfileUpdate({ name: 'A'.repeat(201) });
    expect(errors).toContainEqual(expect.objectContaining({ field: 'name' }));
  });

  it('accepts a valid name with everything else omitted', () => {
    expect(validateOrganizationProfileUpdate({ name: 'Manors Cremation Services' })).toEqual([]);
  });

  it('legalName is optional — omitted or empty is valid', () => {
    expect(validateOrganizationProfileUpdate({ name: 'X', legalName: undefined })).toEqual([]);
    expect(validateOrganizationProfileUpdate({ name: 'X', legalName: '' })).toEqual([]);
  });

  it('24. invalid email is rejected when provided', () => {
    const errors = validateOrganizationProfileUpdate({ name: 'X', primaryEmail: 'not-an-email' });
    expect(errors).toContainEqual(expect.objectContaining({ field: 'primaryEmail' }));
  });

  it('a valid email, or an omitted/empty one, is accepted', () => {
    expect(validateOrganizationProfileUpdate({ name: 'X', primaryEmail: 'contact@manorscremation.com' })).toEqual([]);
    expect(validateOrganizationProfileUpdate({ name: 'X', primaryEmail: '' })).toEqual([]);
  });

  it('validates primaryPhone according to the existing business-phone convention', () => {
    expect(validateOrganizationProfileUpdate({ name: 'X', primaryPhone: '123' })).toContainEqual(expect.objectContaining({ field: 'primaryPhone' }));
    expect(validateOrganizationProfileUpdate({ name: 'X', primaryPhone: '954-884-5770' })).toEqual([]);
  });

  it('25. invalid website is rejected when provided', () => {
    expect(validateOrganizationProfileUpdate({ name: 'X', website: 'not a url' })).toContainEqual(expect.objectContaining({ field: 'website' }));
    expect(validateOrganizationProfileUpdate({ name: 'X', website: 'ftp://example.com' })).toContainEqual(expect.objectContaining({ field: 'website' }));
  });

  it('a valid http/https website, or an omitted/empty one, is accepted', () => {
    expect(validateOrganizationProfileUpdate({ name: 'X', website: 'https://manorscremation.com' })).toEqual([]);
    expect(validateOrganizationProfileUpdate({ name: 'X', website: 'http://example.com' })).toEqual([]);
    expect(validateOrganizationProfileUpdate({ name: 'X', website: '' })).toEqual([]);
  });
});

describe('isValidWebsiteUrl', () => {
  it('empty is valid (optional field)', () => {
    expect(isValidWebsiteUrl('')).toBe(true);
  });
  it('accepts http:// and https://', () => {
    expect(isValidWebsiteUrl('http://example.com')).toBe(true);
    expect(isValidWebsiteUrl('https://example.com')).toBe(true);
  });
  it('rejects a non-http(s) scheme and unparseable input', () => {
    expect(isValidWebsiteUrl('ftp://example.com')).toBe(false);
    expect(isValidWebsiteUrl('not a url at all')).toBe(false);
  });
});

describe('validatePrimaryLocationUpdate', () => {
  const VALID: Record<string, unknown> = {
    name: 'Main Office',
    locationType: 'office',
    addressLine1: '481 E Commercial Blvd',
    city: 'Oakland Park',
    state: 'FL',
    postalCode: '33334',
    country: 'US',
    phone: '954-884-5770',
  };

  it('26. a fully valid submission passes with no errors', () => {
    expect(validatePrimaryLocationUpdate(VALID)).toEqual([]);
  });

  it('26. missing required address fields are rejected', () => {
    for (const field of ['name', 'addressLine1', 'city', 'state', 'postalCode', 'country']) {
      const errors = validatePrimaryLocationUpdate({ ...VALID, [field]: '' });
      expect(errors).toContainEqual(expect.objectContaining({ field }));
    }
  });

  it('27. an invalid locationType is rejected — existing enum only', () => {
    const errors = validatePrimaryLocationUpdate({ ...VALID, locationType: 'headquarters' });
    expect(errors).toContainEqual(expect.objectContaining({ field: 'locationType' }));
  });

  it('accepts every real locationType enum value', () => {
    for (const type of ['office', 'funeral_home', 'crematory', 'mailing_only']) {
      expect(validatePrimaryLocationUpdate({ ...VALID, locationType: type })).toEqual([]);
    }
  });

  it('requires a valid phone number', () => {
    const errors = validatePrimaryLocationUpdate({ ...VALID, phone: '123' });
    expect(errors).toContainEqual(expect.objectContaining({ field: 'phone' }));
  });

  it('validates email only when provided — optional field', () => {
    expect(validatePrimaryLocationUpdate({ ...VALID, email: 'not-an-email' })).toContainEqual(expect.objectContaining({ field: 'email' }));
    expect(validatePrimaryLocationUpdate({ ...VALID, email: 'contact@manorscremation.com' })).toEqual([]);
    expect(validatePrimaryLocationUpdate({ ...VALID, email: undefined })).toEqual([]);
  });

  it('addressLine2 is optional', () => {
    expect(validatePrimaryLocationUpdate({ ...VALID, addressLine2: undefined })).toEqual([]);
    expect(validatePrimaryLocationUpdate({ ...VALID, addressLine2: 'Suite 200' })).toEqual([]);
  });
});
