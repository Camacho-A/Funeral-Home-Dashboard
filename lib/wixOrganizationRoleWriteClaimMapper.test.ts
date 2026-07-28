import { describe, it, expect } from 'vitest';
import { mapWixOrganizationRoleWriteClaimItem, buildWixOrganizationRoleWriteClaimData } from './wixOrganizationRoleWriteClaimMapper';
import type { OrganizationRoleWriteClaim } from '../types/organizationRoleWriteClaim';

const CLAIM: OrganizationRoleWriteClaim = {
  id: 'org-1',
  organizationId: 'org-1',
  lockToken: 'token-1',
  fenceToken: 3,
  claimedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:00:05.000Z',
};

describe('wixOrganizationRoleWriteClaimMapper', () => {
  it('round-trips a valid claim row', () => {
    expect(mapWixOrganizationRoleWriteClaimItem(buildWixOrganizationRoleWriteClaimData(CLAIM))).toEqual(CLAIM);
  });

  it('returns null for undefined', () => {
    expect(mapWixOrganizationRoleWriteClaimItem(undefined)).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixOrganizationRoleWriteClaimItem({ ...buildWixOrganizationRoleWriteClaimData(CLAIM), lockToken: undefined })).toBeNull();
    expect(mapWixOrganizationRoleWriteClaimItem({ ...buildWixOrganizationRoleWriteClaimData(CLAIM), fenceToken: '3' })).toBeNull();
  });
});
