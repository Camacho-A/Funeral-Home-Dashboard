import { describe, it, expect } from 'vitest';
import { mapWixResourceUnavailabilityItem, buildWixResourceUnavailabilityData } from './wixResourceUnavailabilityMapper';
import type { ResourceUnavailability } from '../types/resourceUnavailability';

const UNAVAILABILITY: ResourceUnavailability = {
  id: 'unavailability-1',
  organizationId: 'org-1',
  resourceId: 'resource-1',
  startAt: '2026-08-01T00:00:00.000Z',
  endAt: '2026-08-05T00:00:00.000Z',
  reason: 'maintenance',
  notes: 'In the shop for brake service',
  createdBy: 'identity-1',
  createdAt: '2026-07-30T00:00:00.000Z',
};

describe('wixResourceUnavailabilityMapper', () => {
  it('round-trips a maintenance window', () => {
    expect(mapWixResourceUnavailabilityItem(buildWixResourceUnavailabilityData(UNAVAILABILITY))).toEqual(UNAVAILABILITY);
  });

  it('returns null for undefined', () => {
    expect(mapWixResourceUnavailabilityItem(undefined)).toBeNull();
  });

  it('returns null for an invalid reason', () => {
    expect(mapWixResourceUnavailabilityItem({ ...buildWixResourceUnavailabilityData(UNAVAILABILITY), reason: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixResourceUnavailabilityItem({ ...buildWixResourceUnavailabilityData(UNAVAILABILITY), startAt: undefined })).toBeNull();
  });

  it('exposes no update/apply function — every row is an immutable, fixed statement', async () => {
    const moduleExports = await import('./wixResourceUnavailabilityMapper');
    const exportNames = Object.keys(moduleExports);
    expect(exportNames.some((name) => /^apply/i.test(name))).toBe(false);
  });
});
