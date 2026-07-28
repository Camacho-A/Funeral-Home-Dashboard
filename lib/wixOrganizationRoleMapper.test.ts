import { describe, it, expect } from 'vitest';
import { mapWixOrganizationRoleItem, buildWixOrganizationRoleData } from './wixOrganizationRoleMapper';
import type { OrganizationRoleEnablement } from '../types/organizationRole';

const ENABLEMENT: OrganizationRoleEnablement = {
  id: 'orgrole-1',
  organizationId: 'org-1',
  roleId: 'role-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('wixOrganizationRoleMapper', () => {
  it('round-trips a valid enablement row', () => {
    expect(mapWixOrganizationRoleItem(buildWixOrganizationRoleData(ENABLEMENT))).toEqual(ENABLEMENT);
  });

  it('returns null for undefined', () => {
    expect(mapWixOrganizationRoleItem(undefined)).toBeNull();
  });

  it('returns null when organizationId is missing', () => {
    expect(mapWixOrganizationRoleItem({ ...buildWixOrganizationRoleData(ENABLEMENT), organizationId: undefined })).toBeNull();
  });
});
