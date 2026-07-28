import { describe, it, expect } from 'vitest';
import { mapWixOrganizationRoleAuditEntryItem, buildWixOrganizationRoleAuditEntryData } from './wixOrganizationRoleAuditEntryMapper';
import type { OrganizationRoleAuditEntry } from '../types/organizationRoleAuditEntry';

const ROLE_CREATED: OrganizationRoleAuditEntry = {
  id: 'audit-1',
  organizationId: 'org-1',
  actorIdentityId: 'identity-1',
  action: 'role_created',
  roleId: 'role-1',
  targetIdentityId: null,
  previousRoleKey: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const ROLE_ASSIGNED: OrganizationRoleAuditEntry = {
  ...ROLE_CREATED,
  id: 'audit-2',
  action: 'role_assigned',
  targetIdentityId: 'identity-2',
  previousRoleKey: 'readOnly',
};

const MEMBERSHIP_DISABLED: OrganizationRoleAuditEntry = {
  ...ROLE_CREATED,
  id: 'audit-3',
  action: 'membership_disabled',
  roleId: null,
  targetIdentityId: 'identity-3',
  previousRoleKey: 'officeStaff',
};

describe('wixOrganizationRoleAuditEntryMapper', () => {
  it('round-trips a role_created entry', () => {
    expect(mapWixOrganizationRoleAuditEntryItem(buildWixOrganizationRoleAuditEntryData(ROLE_CREATED))).toEqual(ROLE_CREATED);
  });

  it('round-trips a role_assigned entry with target/previous role', () => {
    expect(mapWixOrganizationRoleAuditEntryItem(buildWixOrganizationRoleAuditEntryData(ROLE_ASSIGNED))).toEqual(ROLE_ASSIGNED);
  });

  it('round-trips a Phase 23 membership_disabled entry — one of the four new action values', () => {
    expect(mapWixOrganizationRoleAuditEntryItem(buildWixOrganizationRoleAuditEntryData(MEMBERSHIP_DISABLED))).toEqual(MEMBERSHIP_DISABLED);
  });

  it('returns null for undefined', () => {
    expect(mapWixOrganizationRoleAuditEntryItem(undefined)).toBeNull();
  });

  it('returns null for an invalid action', () => {
    expect(mapWixOrganizationRoleAuditEntryItem({ ...buildWixOrganizationRoleAuditEntryData(ROLE_CREATED), action: 'bogus' })).toBeNull();
  });
});
