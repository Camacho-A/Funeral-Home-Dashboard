import { describe, expect, it } from 'vitest';
import {
  applyOrganizationUpdateToWixData,
  buildWixOrganizationData,
  mapWixOrganizationItem,
} from './wixOrganizationMapper';
import type { Organization } from '../types/organization';

describe('mapWixOrganizationItem', () => {
  it('maps a well-formed Wix item to the Organization domain shape', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'managed-cremations',
      name: "Manor's Cremation",
      isActive: true,
      _id: 'managed-cremations',
      _createdDate: new Date(),
    } as never);

    expect(result).toEqual({ id: 'managed-cremations', name: "Manor's Cremation", isActive: true });
  });

  it('never uses the Wix system _id as the organization name or domain id', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'managed-cremations',
      name: "Manor's Cremation",
      isActive: true,
      _id: 'some-random-wix-guid-should-never-appear',
    } as never);

    expect(result?.id).toBe('managed-cremations');
    expect(result?.name).not.toBe('some-random-wix-guid-should-never-appear');
  });

  it('returns null when required fields are missing or the wrong type', () => {
    expect(mapWixOrganizationItem(undefined)).toBeNull();
    expect(mapWixOrganizationItem({ name: 'x', isActive: true } as never)).toBeNull();
    expect(mapWixOrganizationItem({ beaconOrganizationId: 'x', isActive: true } as never)).toBeNull();
    expect(mapWixOrganizationItem({ beaconOrganizationId: 'x', name: 'x', isActive: 'yes' } as never)).toBeNull();
  });
});

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). The new
 * profile fields are read defensively — a pre-Phase-20 row (Manor's own,
 * before migration) has none of them and must still map successfully.
 */
describe('mapWixOrganizationItem — Phase 20 profile fields', () => {
  it('maps a pre-Phase-20 row (no new fields at all) without failing', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'managed-cremations',
      name: "Manor's Cremation",
      isActive: true,
    } as never);
    expect(result).not.toBeNull();
    expect(result?.slug).toBeUndefined();
    expect(result?.status).toBeUndefined();
  });

  it('maps every new field when present', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'managed-cremations',
      name: "Manor's Cremation",
      isActive: true,
      legalName: "Manor's Cremation Services, LLC",
      slug: 'manors-cremation',
      status: 'active',
      timezone: 'America/New_York',
      defaultCurrency: 'usd',
      primaryEmail: 'staff@managedcremations.test',
      primaryPhone: '(555) 201-4432',
      website: 'https://managedcremations.test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);
    expect(result).toEqual({
      id: 'managed-cremations',
      name: "Manor's Cremation",
      isActive: true,
      legalName: "Manor's Cremation Services, LLC",
      slug: 'manors-cremation',
      status: 'active',
      timezone: 'America/New_York',
      defaultCurrency: 'usd',
      primaryEmail: 'staff@managedcremations.test',
      primaryPhone: '(555) 201-4432',
      website: 'https://managedcremations.test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('ignores an invalid status value rather than mapping it through', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'x',
      name: 'x',
      isActive: true,
      status: 'not-a-real-status',
    } as never);
    expect(result?.status).toBeUndefined();
  });
});

describe('buildWixOrganizationData / applyOrganizationUpdateToWixData', () => {
  const ORG: Organization = {
    id: 'org-1',
    name: 'Test Org',
    isActive: false,
    status: 'draft',
    slug: 'test-org',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('round-trips through build then map', () => {
    const wixData = buildWixOrganizationData(ORG);
    expect(mapWixOrganizationItem(wixData)).toEqual(ORG);
  });

  it('applies a partial update without disturbing other fields', () => {
    const existing = buildWixOrganizationData(ORG);
    const merged = applyOrganizationUpdateToWixData(existing, {
      status: 'active',
      isActive: true,
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    const mapped = mapWixOrganizationItem(merged);
    expect(mapped?.status).toBe('active');
    expect(mapped?.isActive).toBe(true);
    expect(mapped?.slug).toBe('test-org'); // untouched
    expect(mapped?.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });
});
