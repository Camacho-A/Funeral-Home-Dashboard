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

describe('mapWixOrganizationItem — enabledModules (Manors launch-prep)', () => {
  it('maps a row with no enabledModulesJson at all to enabledModules: undefined', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'x',
      name: 'x',
      isActive: true,
    } as never);
    expect(result?.enabledModules).toBeUndefined();
  });

  it('parses a well-formed JSON array', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'x',
      name: 'x',
      isActive: true,
      enabledModulesJson: JSON.stringify(['accounting', 'merchandise']),
    } as never);
    expect(result?.enabledModules).toEqual(['accounting', 'merchandise']);
  });

  it('falls back to undefined on malformed JSON rather than throwing', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'x',
      name: 'x',
      isActive: true,
      enabledModulesJson: 'not json',
    } as never);
    expect(result?.enabledModules).toBeUndefined();
  });
});

/** Manors accounting/reports cleanup (2026-10). Same JSON-in-text-field
    convention as enabledModules above, opposite polarity. */
describe('mapWixOrganizationItem — hiddenModules (Manors accounting/reports cleanup)', () => {
  it('maps a row with no hiddenModulesJson at all to hiddenModules: undefined', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'x',
      name: 'x',
      isActive: true,
    } as never);
    expect(result?.hiddenModules).toBeUndefined();
  });

  it('parses a well-formed JSON array', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'x',
      name: 'x',
      isActive: true,
      hiddenModulesJson: JSON.stringify(['accounting-banking', 'reports-staff']),
    } as never);
    expect(result?.hiddenModules).toEqual(['accounting-banking', 'reports-staff']);
  });

  it('falls back to undefined on malformed JSON rather than throwing', () => {
    const result = mapWixOrganizationItem({
      beaconOrganizationId: 'x',
      name: 'x',
      isActive: true,
      hiddenModulesJson: 'not json',
    } as never);
    expect(result?.hiddenModules).toBeUndefined();
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

  it('round-trips enabledModules through build then map', () => {
    const withModules: Organization = { ...ORG, enabledModules: ['accounting', 'resources'] };
    const wixData = buildWixOrganizationData(withModules);
    expect(mapWixOrganizationItem(wixData)?.enabledModules).toEqual(['accounting', 'resources']);
  });

  it('applyOrganizationUpdateToWixData patches enabledModules, including clearing it to null', () => {
    const existing = buildWixOrganizationData(ORG);
    const withModules = applyOrganizationUpdateToWixData(existing, { enabledModules: ['inventory'] });
    expect(mapWixOrganizationItem(withModules)?.enabledModules).toEqual(['inventory']);

    const cleared = applyOrganizationUpdateToWixData(withModules, { enabledModules: null });
    expect(mapWixOrganizationItem(cleared)?.enabledModules).toBeUndefined();
  });

  it('round-trips hiddenModules through build then map', () => {
    const withHidden: Organization = { ...ORG, hiddenModules: ['accounting-banking', 'reports-documents'] };
    const wixData = buildWixOrganizationData(withHidden);
    expect(mapWixOrganizationItem(wixData)?.hiddenModules).toEqual(['accounting-banking', 'reports-documents']);
  });

  it('applyOrganizationUpdateToWixData patches hiddenModules, including clearing it to null', () => {
    const existing = buildWixOrganizationData(ORG);
    const withHidden = applyOrganizationUpdateToWixData(existing, { hiddenModules: ['reports-staff'] });
    expect(mapWixOrganizationItem(withHidden)?.hiddenModules).toEqual(['reports-staff']);

    const cleared = applyOrganizationUpdateToWixData(withHidden, { hiddenModules: null });
    expect(mapWixOrganizationItem(cleared)?.hiddenModules).toBeUndefined();
  });

  /**
   * Settings → Organization Profile (2026-09). A full-object-merge-safety
   * regression: a profile-editor-shaped patch (only `name`/`legalName`/
   * `primaryEmail`/`primaryPhone`/`website` — exactly what
   * `app/api/organization/profile/route.ts` ever sends) must never disturb
   * any technical/configuration field, even when every one of those
   * fields already carries a real, non-default value.
   */
  it('an Organization-Profile-shaped patch never disturbs technical/configuration fields', () => {
    const FULLY_CONFIGURED: Organization = {
      id: 'managed-cremations',
      name: "Manor's Cremation",
      isActive: true,
      legalName: 'Old Legal Name',
      slug: 'manors-cremation',
      status: 'active',
      timezone: 'America/Chicago',
      defaultCurrency: 'usd',
      primaryEmail: 'old@example.test',
      primaryPhone: '(555) 000-0000',
      website: 'https://old.example.com',
      requireMfa: true,
      enabledModules: ['inventory', 'resources'],
      familyPortalEnabled: false,
      signatureRequestsEnabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const existing = buildWixOrganizationData(FULLY_CONFIGURED);
    const merged = applyOrganizationUpdateToWixData(existing, {
      name: 'MANORS CREMATION SERVICES',
      legalName: 'MANORS CREMATION SERVICES, LLC',
      primaryEmail: 'contact@manorscremation.com',
      primaryPhone: '954-884-5770',
      website: 'https://manorscremation.com',
      updatedAt: '2026-09-28T00:00:00.000Z',
    });
    const mapped = mapWixOrganizationItem(merged);

    expect(mapped?.name).toBe('MANORS CREMATION SERVICES');
    expect(mapped?.legalName).toBe('MANORS CREMATION SERVICES, LLC');
    expect(mapped?.primaryEmail).toBe('contact@manorscremation.com');
    expect(mapped?.primaryPhone).toBe('954-884-5770');
    expect(mapped?.website).toBe('https://manorscremation.com');

    // Every technical/configuration field: untouched.
    expect(mapped?.id).toBe('managed-cremations');
    expect(mapped?.slug).toBe('manors-cremation');
    expect(mapped?.status).toBe('active');
    expect(mapped?.timezone).toBe('America/Chicago');
    expect(mapped?.defaultCurrency).toBe('usd');
    expect(mapped?.requireMfa).toBe(true);
    expect(mapped?.enabledModules).toEqual(['inventory', 'resources']);
    expect(mapped?.familyPortalEnabled).toBe(false);
    expect(mapped?.signatureRequestsEnabled).toBe(false);
    expect(mapped?.isActive).toBe(true);
    expect(mapped?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
