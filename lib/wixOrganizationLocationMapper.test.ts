import { describe, expect, it } from 'vitest';
import { applyOrganizationLocationUpdateToWixData, buildWixOrganizationLocationData, mapWixOrganizationLocationItem } from './wixOrganizationLocationMapper';
import type { OrganizationLocation } from '../types/organizationLocation';

const LOCATION: OrganizationLocation = {
  id: 'location-1',
  organizationId: 'org-1',
  name: 'Main Office',
  locationType: 'office',
  addressLine1: '100 Memorial Drive',
  addressLine2: null,
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'US',
  phone: '(555) 201-4432',
  email: null,
  isPrimary: true,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('mapWixOrganizationLocationItem / buildWixOrganizationLocationData', () => {
  it('round-trips through build then map', () => {
    const wixData = buildWixOrganizationLocationData(LOCATION);
    expect(mapWixOrganizationLocationItem(wixData)).toEqual(LOCATION);
  });

  it('returns null for a malformed item', () => {
    expect(mapWixOrganizationLocationItem(undefined)).toBeNull();
    expect(mapWixOrganizationLocationItem({ ...buildWixOrganizationLocationData(LOCATION), locationType: 'not-a-real-type' })).toBeNull();
  });
});

/**
 * Settings → Organization Profile (2026-09). `applyOrganizationLocationUpdateToWixData`
 * is the merge-before-full-replace safety net for `updatePrimaryLocation`
 * (`organizationProvisioningService.ts`) — same discipline as
 * `applyOrganizationUpdateToWixData`'s own tests in `wixOrganizationMapper.test.ts`.
 */
describe('applyOrganizationLocationUpdateToWixData', () => {
  it('applies only the patched fields, leaving everything else untouched', () => {
    const existing = buildWixOrganizationLocationData(LOCATION);
    const merged = applyOrganizationLocationUpdateToWixData(existing, {
      addressLine1: '481 E Commercial Blvd',
      city: 'Oakland Park',
      state: 'FL',
      postalCode: '33334',
      phone: '954-884-5770',
      updatedAt: '2026-09-28T00:00:00.000Z',
    });
    const mapped = mapWixOrganizationLocationItem(merged);

    expect(mapped?.addressLine1).toBe('481 E Commercial Blvd');
    expect(mapped?.city).toBe('Oakland Park');
    expect(mapped?.state).toBe('FL');
    expect(mapped?.postalCode).toBe('33334');
    expect(mapped?.phone).toBe('954-884-5770');
    expect(mapped?.updatedAt).toBe('2026-09-28T00:00:00.000Z');

    // Identity/bookkeeping fields: never part of the patch, always survive.
    expect(mapped?.id).toBe('location-1');
    expect(mapped?.organizationId).toBe('org-1');
    expect(mapped?.name).toBe('Main Office');
    expect(mapped?.locationType).toBe('office');
    expect(mapped?.isPrimary).toBe(true);
    expect(mapped?.isActive).toBe(true);
    expect(mapped?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('never applies isPrimary/isActive/organizationId/createdAt even if a caller\'s patch object carried one', () => {
    const existing = buildWixOrganizationLocationData(LOCATION);
    const merged = applyOrganizationLocationUpdateToWixData(existing, {
      isPrimary: false,
      isActive: false,
      organizationId: 'a-different-org',
      createdAt: '1999-01-01T00:00:00.000Z',
    } as Partial<OrganizationLocation>);
    const mapped = mapWixOrganizationLocationItem(merged);

    expect(mapped?.isPrimary).toBe(true);
    expect(mapped?.isActive).toBe(true);
    expect(mapped?.organizationId).toBe('org-1');
    expect(mapped?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('clearing addressLine2 to null is a real, applied change', () => {
    const withLine2 = buildWixOrganizationLocationData({ ...LOCATION, addressLine2: 'Suite 200' });
    const merged = applyOrganizationLocationUpdateToWixData(withLine2, { addressLine2: null });
    expect(mapWixOrganizationLocationItem(merged)?.addressLine2).toBeNull();
  });
});
