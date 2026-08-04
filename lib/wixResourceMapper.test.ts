import { describe, it, expect } from 'vitest';
import { mapWixResourceItem, buildWixResourceData, applyResourceUpdateToWixData } from './wixResourceMapper';
import type { Resource } from '../types/resource';

const STAFF_RESOURCE: Resource = {
  id: 'resource-1',
  organizationId: 'org-1',
  locationId: 'location-1',
  resourceType: 'staff',
  name: 'Jane Director',
  linkedMembershipId: 'membership-1',
  capacity: null,
  isExternal: false,
  status: 'active',
  notes: null,
  resourceVersion: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const CEMETERY_RESOURCE: Resource = {
  ...STAFF_RESOURCE,
  id: 'resource-2',
  resourceType: 'cemetery',
  name: 'Green Hills Cemetery',
  linkedMembershipId: null,
  isExternal: true,
  capacity: null,
};

describe('wixResourceMapper', () => {
  it('round-trips a staff resource with a linkedMembershipId', () => {
    expect(mapWixResourceItem(buildWixResourceData(STAFF_RESOURCE))).toEqual(STAFF_RESOURCE);
  });

  it('round-trips an external cemetery resource', () => {
    expect(mapWixResourceItem(buildWixResourceData(CEMETERY_RESOURCE))).toEqual(CEMETERY_RESOURCE);
  });

  it('returns null for undefined', () => {
    expect(mapWixResourceItem(undefined)).toBeNull();
  });

  it('returns null for an invalid resourceType/status', () => {
    expect(mapWixResourceItem({ ...buildWixResourceData(STAFF_RESOURCE), resourceType: 'bogus' })).toBeNull();
    expect(mapWixResourceItem({ ...buildWixResourceData(STAFF_RESOURCE), status: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixResourceItem({ ...buildWixResourceData(STAFF_RESOURCE), isExternal: 'false' })).toBeNull();
    expect(mapWixResourceItem({ ...buildWixResourceData(STAFF_RESOURCE), resourceVersion: undefined })).toBeNull();
  });

  it('applyResourceUpdateToWixData changes only the patched fields', () => {
    const wixItem = buildWixResourceData(STAFF_RESOURCE);
    const updated = applyResourceUpdateToWixData(wixItem, { status: 'maintenance' });
    expect(updated.status).toBe('maintenance');
    expect(updated.name).toBe(wixItem.name);
    expect(updated.linkedMembershipId).toBe(wixItem.linkedMembershipId);
  });
});
