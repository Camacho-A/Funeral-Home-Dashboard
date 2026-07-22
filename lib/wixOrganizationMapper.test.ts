import { describe, expect, it } from 'vitest';
import { mapWixOrganizationItem } from './wixOrganizationMapper';

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
