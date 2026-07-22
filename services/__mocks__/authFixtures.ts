import type { AuthenticatedUser } from '../../types/auth';
import type { Organization, OrganizationMembership } from '../../types/organization';
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

export const mockMembershipFixtures: OrganizationMembership[] = [
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockDefaultUser.id, role: 'administrator', isActive: true },
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockMultiOrgUser.id, role: 'staff', isActive: true },
  { organizationId: SECOND_MOCK_ORGANIZATION_ID, userId: mockMultiOrgUser.id, role: 'caseManager', isActive: true },
  { organizationId: DEFAULT_ORGANIZATION_ID, userId: mockInactiveMembershipUser.id, role: 'staff', isActive: false },
];

/**
 * Obviously-fake, dev-only mock login credentials — never validated
 * against anything resembling a real password hash (there's nothing to
 * hash; this is a single hardcoded literal, checked in
 * lib/auth/mockAuth.ts). Never used or referenced outside mock mode.
 */
export const MOCK_LOGIN_EMAIL = mockDefaultUser.email;
export const MOCK_LOGIN_PASSWORD = 'mock-password-not-real';
