import { describe, expect, it } from 'vitest';
import { normalizeOrganizationProfileTextFields, normalizePrimaryLocationTextFields } from './textNormalization';

describe('normalizeOrganizationProfileTextFields', () => {
  it('29/30. uppercases name and legalName (business prose)', () => {
    const result = normalizeOrganizationProfileTextFields({ name: 'manors cremation services', legalName: "manor's cremation, llc" });
    expect(result.name).toBe('MANORS CREMATION SERVICES');
    expect(result.legalName).toBe("MANOR'S CREMATION, LLC");
  });

  it('30. never uppercases primaryEmail', () => {
    const result = normalizeOrganizationProfileTextFields({ name: 'X', primaryEmail: 'Contact@ManorsCremation.com' });
    expect((result as { primaryEmail?: string }).primaryEmail).toBe('Contact@ManorsCremation.com');
  });

  it('never uppercases primaryPhone', () => {
    const result = normalizeOrganizationProfileTextFields({ name: 'X', primaryPhone: '954-884-5770' });
    expect((result as { primaryPhone?: string }).primaryPhone).toBe('954-884-5770');
  });

  it('31. never uppercases website', () => {
    const result = normalizeOrganizationProfileTextFields({ name: 'X', website: 'https://ManorsCremation.com' });
    expect((result as { website?: string }).website).toBe('https://ManorsCremation.com');
  });

  it('leaves non-string/absent fields untouched', () => {
    const result = normalizeOrganizationProfileTextFields({ name: undefined });
    expect(result.name).toBeUndefined();
  });
});

describe('normalizePrimaryLocationTextFields', () => {
  it('uppercases name/addressLine1/addressLine2/city/state/postalCode/country', () => {
    const result = normalizePrimaryLocationTextFields({
      name: 'main office',
      addressLine1: '481 e commercial blvd',
      addressLine2: 'suite 200',
      city: 'oakland park',
      state: 'fl',
      postalCode: '33334',
      country: 'us',
    });
    expect(result.name).toBe('MAIN OFFICE');
    expect(result.addressLine1).toBe('481 E COMMERCIAL BLVD');
    expect(result.addressLine2).toBe('SUITE 200');
    expect(result.city).toBe('OAKLAND PARK');
    expect(result.state).toBe('FL');
    expect(result.postalCode).toBe('33334');
    expect(result.country).toBe('US');
  });

  it('32. never uppercases locationType (an enum)', () => {
    const result = normalizePrimaryLocationTextFields({ name: 'X', locationType: 'funeral_home' } as Record<string, unknown>);
    expect((result as { locationType?: string }).locationType).toBe('funeral_home');
  });

  it('never uppercases phone', () => {
    const result = normalizePrimaryLocationTextFields({ name: 'X', phone: '954-884-5770' } as Record<string, unknown>);
    expect((result as { phone?: string }).phone).toBe('954-884-5770');
  });

  it('never uppercases email', () => {
    const result = normalizePrimaryLocationTextFields({ name: 'X', email: 'Contact@ManorsCremation.com' } as Record<string, unknown>);
    expect((result as { email?: string }).email).toBe('Contact@ManorsCremation.com');
  });

  it('a null addressLine2 (clearing it) is left as null, not stringified', () => {
    const result = normalizePrimaryLocationTextFields({ name: 'X', addressLine2: null });
    expect(result.addressLine2).toBeNull();
  });
});
