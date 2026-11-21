import type { Identity, IdentitySecrets } from '../../types/identity';
import type { Membership } from '../../types/membership';
import type { StaffProfile } from '../../types/staffProfile';
import { hashPassword } from '../../lib/identity/passwordHashing';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from './organizationIds';

/**
 * Unified portal (Phase 5N, 2026-11). Fictional staff who belong to BOTH
 * Manors (managed-cremations) and Gus (gus-camacho-jr), each with a
 * DIFFERENT role in each — so every combined view and every write can be
 * tested against per-organization permissions. One membership per
 * organization; nothing here grants anything across organizations.
 *
 *   Casey Dual — Gus Manager,          Manors Office Staff
 *   Robin Dual — Manors Funeral Director, Gus Read Only
 *
 * Present only with the sandbox switch (identityFixtures.ts / fixtures.ts
 * include them then); tests push them explicitly. Never real people.
 */
export const UNIFIED_DEMO_PASSWORD = 'UnifiedDemo123!';
export const CASEY_DUAL_IDENTITY_ID = 'identity-dual-casey';
export const ROBIN_DUAL_IDENTITY_ID = 'identity-dual-robin';
export const CASEY_DUAL_EMAIL = 'casey.dual@unified-demo.test';
export const ROBIN_DUAL_EMAIL = 'robin.dual@unified-demo.test';

const NOW = '2026-11-20T12:00:00.000Z';

type Seed = { identityId: string; email: string; displayName: string; roles: { organizationId: string; roleKey: string; staffRole: StaffProfile['role'] }[] };

const SEEDS: readonly Seed[] = [
  {
    identityId: CASEY_DUAL_IDENTITY_ID,
    email: CASEY_DUAL_EMAIL,
    displayName: 'Casey Dual',
    roles: [
      { organizationId: GUS_ORGANIZATION_ID, roleKey: 'manager', staffRole: 'staff' },
      { organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', staffRole: 'staff' },
    ],
  },
  {
    identityId: ROBIN_DUAL_IDENTITY_ID,
    email: ROBIN_DUAL_EMAIL,
    displayName: 'Robin Dual',
    roles: [
      { organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'funeralDirector', staffRole: 'funeral_director' },
      { organizationId: GUS_ORGANIZATION_ID, roleKey: 'readOnly', staffRole: 'staff' },
    ],
  },
];

const short = (organizationId: string) => (organizationId === GUS_ORGANIZATION_ID ? 'gus' : 'manors');
export const dualMembershipId = (identityId: string, organizationId: string) => `membership-${identityId.replace('identity-', '')}-${short(organizationId)}`;
export const dualStaffId = (identityId: string, organizationId: string) => `staff-${identityId.replace('identity-', '')}-${short(organizationId)}`;

/** `passwordHash` is a getter: hashing uses Node crypto, which must never run in a browser bundle. */
export function buildDualOrganizationIdentities(): Array<Identity & IdentitySecrets> {
  return SEEDS.map((seed) => ({
    id: seed.identityId,
    email: seed.email,
    normalizedEmail: seed.email.toLowerCase(),
    displayName: seed.displayName,
    phone: null,
    status: 'active' as const,
    emailVerified: true,
    passwordVersion: 1,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    get passwordHash() {
      return hashPassword(UNIFIED_DEMO_PASSWORD);
    },
    mfaSecretReference: null,
    mfaVerifiedAt: null,
    mfaRecoveryCodeHashes: [],
  }));
}

export function buildDualOrganizationMemberships(): Membership[] {
  return SEEDS.flatMap((seed) =>
    seed.roles.map((r) => ({
      id: dualMembershipId(seed.identityId, r.organizationId),
      identityId: seed.identityId,
      organizationId: r.organizationId,
      role: r.roleKey as Membership['role'],
      status: 'active' as const,
      invitedBy: null,
      joinedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  );
}

export function buildDualOrganizationStaff(): StaffProfile[] {
  return SEEDS.flatMap((seed) =>
    seed.roles.map((r) => ({
      id: dualStaffId(seed.identityId, r.organizationId),
      organizationId: r.organizationId,
      identityId: seed.identityId,
      membershipId: dualMembershipId(seed.identityId, r.organizationId),
      displayName: seed.displayName,
      role: r.staffRole,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  );
}
