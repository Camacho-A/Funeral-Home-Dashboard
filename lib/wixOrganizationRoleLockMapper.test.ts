import { describe, it, expect } from 'vitest';
import { mapWixOrganizationRoleLockItem, buildWixOrganizationRoleLockData } from './wixOrganizationRoleLockMapper';
import type { OrganizationRoleLock } from '../types/organizationRoleLock';

const LOCK: OrganizationRoleLock = {
  id: 'org-1',
  organizationId: 'org-1',
  lockToken: 'token-1',
  fenceToken: 3,
  lockedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:00:10.000Z',
};

describe('wixOrganizationRoleLockMapper', () => {
  it('round-trips a valid lock row', () => {
    expect(mapWixOrganizationRoleLockItem(buildWixOrganizationRoleLockData(LOCK))).toEqual(LOCK);
  });

  it('returns null for undefined', () => {
    expect(mapWixOrganizationRoleLockItem(undefined)).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    expect(mapWixOrganizationRoleLockItem({ ...buildWixOrganizationRoleLockData(LOCK), lockToken: undefined })).toBeNull();
  });

  it('returns null when fenceToken is missing or not a number', () => {
    expect(mapWixOrganizationRoleLockItem({ ...buildWixOrganizationRoleLockData(LOCK), fenceToken: undefined })).toBeNull();
    expect(mapWixOrganizationRoleLockItem({ ...buildWixOrganizationRoleLockData(LOCK), fenceToken: '3' })).toBeNull();
  });
});
