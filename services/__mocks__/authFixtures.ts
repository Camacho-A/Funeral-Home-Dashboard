import type { AuthenticatedUser } from '../../types/auth';
import type { Organization, OrganizationMembership, OrganizationRole } from '../../types/organization';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './organizationIds';
import { staffFixtures } from './fixtures';

/**
 * Phase 13 (Authentication & Organizations). Mock-only identities and
 * organization membership data — used exclusively when DATA_ADAPTER=mock
 * (the default) and by tests. Every id here is prefixed `mock-` so none
 * could ever be mistaken for a real Wix member `_id` (a GUID) at a glance
 * — see docs/AUTHENTICATION.md's "Mock vs. production identity" section.
 */

export const mockOrganizationFixtures: Organization[] = [
  { id: DEFAULT_ORGANIZATION_ID, name: "Manor's Cremation", isActive: true },
  { id: SECOND_MOCK_ORGANIZATION_ID, name: 'Evergreen Memorial Group', isActive: true },
];

/**
 * The default mock user — used by the mock login flow and local dev.
 * Belongs to exactly one organization (Managed Cremations), per this
 * phase's own requirement. Named after the same person hooks/useSession.ts
 * (Phase 4) already represents as the current staff user
 * (staffFixtures[0]) so the demo story is coherent, without merging the
 * two type systems — an AuthenticatedUser is a login identity, a
 * StaffProfile is a case-assignee identity; they describe the same person
 * here without being the same concept.
 */
export const mockDefaultUser: AuthenticatedUser = {
  id: 'mock-user-dana',
  email: 'dana@managedcremations.test',
  displayName: staffFixtures[0].displayName,
  source: 'mock',
};

/**
 * A second mock user, belonging to two organizations — exists only to
 * exercise the multi-membership selection path in tests. Never the
 * default dev login identity, and not reachable through the mock login
 * form (no way to "sign in as" this user via credentials — tests
 * construct sessions for it directly).
 */
export const mockMultiOrgUser: AuthenticatedUser = {
  id: 'mock-user-multi-org',
  email: 'multi-org@beacon.test',
  displayName: 'Multi-Org Test User',
  source: 'mock',
};

/** Exists only for the "reject inactive membership" test — has a
    membership row, but it's inactive, so access must still be denied. */
export const mockInactiveMembershipUser: AuthenticatedUser = {
  id: 'mock-user-inactive',
  email: 'inactive@beacon.test',
  displayName: 'Inactive Test User',
  source: 'mock',
};

/**
 * Manors RBAC restriction (2026-09) — one mock user per non-administrator
 * Manors DefaultRoleKey (manager/officeStaff/accounting/readOnly/dispatch),
 * so a route test can assert "this specific named role is denied" against
 * a real `requireAuthorizedOrganization`-resolved role, rather than only a
 * generic non-admin user. Belongs to DEFAULT_ORGANIZATION_ID only — no
 * test needs these cross-org.
 */
export const mockFuneralDirectorUser: AuthenticatedUser = {
  id: 'mock-user-funeral-director',
  email: 'funeral-director@managedcremations.test',
  displayName: 'Funeral Director Test User',
  source: 'mock',
};
export const mockManagerUser: AuthenticatedUser = {
  id: 'mock-user-manager',
  email: 'manager@managedcremations.test',
  displayName: 'Manager Test User',
  source: 'mock',
};
export const mockOfficeStaffUser: AuthenticatedUser = {
  id: 'mock-user-office-staff',
  email: 'office-staff@managedcremations.test',
  displayName: 'Office Staff Test User',
  source: 'mock',
};
export const mockAccountingUser: AuthenticatedUser = {
  id: 'mock-user-accounting',
  email: 'accounting@managedcremations.test',
  displayName: 'Accounting Test User',
  source: 'mock',
};
export const mockReadOnlyUser: AuthenticatedUser = {
  id: 'mock-user-read-only',
  email: 'read-only@managedcremations.test',
  displayName: 'Read Only Test User',
  source: 'mock',
};
export const mockDispatchUser: AuthenticatedUser = {
  id: 'mock-user-dispatch',
  email: 'dispatch@managedcremations.test',
  displayName: 'Dispatch Test User',
  source: 'mock',
};

export const mockMembershipFixtures: OrganizationMembership[] = [
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockDefaultUser.id, role: 'administrator', isActive: true },
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockMultiOrgUser.id, role: 'staff', isActive: true },
  { organizationId: SECOND_MOCK_ORGANIZATION_ID, userId: mockMultiOrgUser.id, role: 'caseManager', isActive: true },
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockInactiveMembershipUser.id, role: 'staff', isActive: false },
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockFuneralDirectorUser.id, role: 'funeralDirector' as OrganizationRole, isActive: true },
  // These 4 use real RBAC DefaultRoleKey strings, not legacy OrganizationRole
  // literals — `AuthorizationContext.role` is passed straight through to
  // `resolveRoleForKey` as an opaque roleKey (see
  // services/permissionService.ts), so any string that matches a real
  // 'roles' collection key resolves correctly; the cast only widens what
  // TypeScript will accept for this mock-only fixture's `role` field.
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockManagerUser.id, role: 'manager' as OrganizationRole, isActive: true },
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockOfficeStaffUser.id, role: 'officeStaff' as OrganizationRole, isActive: true },
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockAccountingUser.id, role: 'accounting' as OrganizationRole, isActive: true },
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockReadOnlyUser.id, role: 'readOnly', isActive: true },
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockDispatchUser.id, role: 'dispatch' as OrganizationRole, isActive: true },
];

/**
 * Obviously-fake, dev-only mock login credentials — never validated
 * against anything resembling a real password hash (there's nothing to
 * hash; this is a single hardcoded literal, checked in
 * lib/auth/mockAuth.ts). Never used or referenced outside mock mode.
 */
export const MOCK_LOGIN_EMAIL = mockDefaultUser.email;
export const MOCK_LOGIN_PASSWORD = 'mock-password-not-real';
