import { describe, expect, it } from 'vitest';
import {
  isValidCurrencyCode,
  isValidTimezone,
  validateOrganizationProfile,
  validatePrimaryLocation,
} from './validation';

describe('isValidTimezone', () => {
  it('accepts real IANA timezone names', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('rejects garbage input', () => {
    expect(isValidTimezone('Not/A/Timezone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});

describe('isValidCurrencyCode', () => {
  it('accepts a 3-letter code regardless of case', () => {
    expect(isValidCurrencyCode('usd')).toBe(true);
    expect(isValidCurrencyCode('USD')).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(isValidCurrencyCode('dollars')).toBe(false);
    expect(isValidCurrencyCode('us')).toBe(false);
    expect(isValidCurrencyCode('')).toBe(false);
  });
});

describe('validateOrganizationProfile', () => {
  const VALID = {
    legalName: "Manor's Cremation Services, LLC",
    displayName: "Manor's Cremation",
    primaryEmail: 'staff@managedcremations.test',
    primaryPhone: '(555) 201-4432',
    website: 'https://example.com',
    timezone: 'America/New_York',
    defaultCurrency: 'usd',
  };

  it('returns no errors for a fully valid profile', () => {
    expect(validateOrganizationProfile(VALID)).toEqual([]);
  });

  it('returns a field-specific error for each missing/invalid required field', () => {
    const errors = validateOrganizationProfile({});
    const fields = errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining(['legalName', 'displayName', 'primaryEmail', 'primaryPhone', 'timezone', 'defaultCurrency']),
    );
  });

  it('rejects an invalid email specifically on the primaryEmail field', () => {
    const errors = validateOrganizationProfile({ ...VALID, primaryEmail: 'not-an-email' });
    expect(errors).toEqual([{ field: 'primaryEmail', message: expect.stringContaining('email') }]);
  });

  it('allows website to be omitted entirely', () => {
    const { website, ...rest } = VALID;
    void website;
    expect(validateOrganizationProfile(rest)).toEqual([]);
  });
});

describe('validatePrimaryLocation', () => {
  const VALID = {
    name: 'Main Office',
    addressLine1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    country: 'US',
    phone: '(555) 201-4432',
    email: 'location@example.com',
  };

  it('returns no errors for a fully valid location', () => {
    expect(validatePrimaryLocation(VALID)).toEqual([]);
  });

  it('flags every required field missing', () => {
    const errors = validatePrimaryLocation({});
    const fields = errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining(['name', 'addressLine1', 'city', 'state', 'postalCode', 'country', 'phone']),
    );
  });

  it('allows email to be omitted', () => {
    const { email, ...rest } = VALID;
    void email;
    expect(validatePrimaryLocation(rest)).toEqual([]);
  });
});
