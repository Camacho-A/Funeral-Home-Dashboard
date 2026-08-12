import type { Identity, IdentitySecrets } from '../../types/identity';
import type { Membership } from '../../types/membership';
import type { IdentitySession } from '../../types/identitySession';
import type { EmailVerificationToken } from '../../types/emailVerificationToken';
import type { PasswordResetToken } from '../../types/passwordResetToken';
import type { LoginActivityEvent } from '../../types/loginActivityEvent';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';
import { hashPassword } from '../../lib/identity/passwordHashing';
import { mockDefaultUser } from './authFixtures';

/**
 * Phase 21 (Identity, Authentication & Session Management). Mock-mode
 * fixtures — same "in-memory arrays, mutated in place by the identity
 * services' mock branch" convention as every other `services/__mocks__/
 * *Fixtures.ts` file.
 *
 * `MockIdentityRecord` combines the public `Identity` shape and the
 * internal `IdentitySecrets` shape into one row, mirroring exactly how
 * both live on the same Wix item in wix mode (see
 * `lib/wixIdentityMapper.ts`) — `services/identityService.ts`'s mock
 * branch splits it the same way the mapper does before returning to any
 * caller outside `passwordService.ts`/`mfaService.ts`.
 *
 * Manor's Cremation's existing administrator (Dana, `mockDefaultUser`) is
 * seeded here directly with a real, working demo password — the same
 * "seed the one real tenant's row in the fixture file itself" convention
 * `paymentIntegrationFixtures`/`organizationLocationFixtures` already
 * established — representing that this phase's own identity migration
 * (`services/identityService.ts`'s `migrateExistingUsers`) has already run
 * in mock mode.
 */
export type MockIdentityRecord = Identity & IdentitySecrets;

const NOW = '2026-07-24T00:00:00.000Z';

/** Never a real secret — a fixed, documented demo password for mock-mode
    identity login (dev/demo/test only; wix-mode identities always get a
    freshly hashed real password, never this one). */
export const MANORS_ADMIN_DEMO_PASSWORD = 'BeaconDemo123!';
export const MANORS_ADMIN_IDENTITY_ID = 'identity-manors-admin';
export const MANORS_ADMIN_MEMBERSHIP_ID = 'membership-manors-admin';

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification).
 * Chris and Priya — the other two `StaffProfile` fixtures
 * (`services/__mocks__/fixtures.ts`'s `staffFixtures`) — gain real
 * `Identity`/`Membership` rows here, the mock-mode equivalent of what the
 * live migration script resolves for Manor's Cremation's real roster (see
 * `docs/adr/ADR-034-identity-model-hardening-and-staff-assignment-architecture.md`'s
 * migration section). `StaffProfile.role` (`'funeral_director'`/`'staff'`)
 * is deliberately NOT mirrored 1:1 into `Membership.role` here — Chris
 * gets `'manager'` (not `'funeralDirector'`) specifically to avoid
 * silently inflating the membership count of an existing role several
 * other test suites assert an exact fan-out count for (e.g.
 * `notificationService.test.ts`'s `role`-scope test). This is a fixture
 * choice only; `StaffProfile.role` stays display-only, never read at
 * runtime, per that type's own header comment.
 */
export const MANORS_CHRIS_IDENTITY_ID = 'identity-manors-chris';
export const MANORS_CHRIS_MEMBERSHIP_ID = 'membership-manors-chris';
export const MANORS_PRIYA_IDENTITY_ID = 'identity-manors-priya';
export const MANORS_PRIYA_MEMBERSHIP_ID = 'membership-manors-priya';

// `passwordHash` is a getter, not a plain value, on every row below —
// Phase 30 wired `casesService.ts` (client-importable) through to
// `membershipService.ts`, which imports `membershipFixtures` from this same
// module, so this file's top-level evaluation now also runs client-side.
// An eager `hashPassword()` call here invokes Node's `crypto.scryptSync`,
// which the webpack browser polyfill doesn't provide, crashing the entire
// AppShell on hydration. A getter defers that call until something actually
// reads `.passwordHash` — which only ever happens server-side (`identityService.ts`'s
// mock branch, called only from Server Actions/Route Handlers).
export const identityFixtures: MockIdentityRecord[] = [
  {
    id: MANORS_ADMIN_IDENTITY_ID,
    email: mockDefaultUser.email,
    normalizedEmail: mockDefaultUser.email.toLowerCase(),
    displayName: mockDefaultUser.displayName,
    phone: null,
    status: 'active',
    emailVerified: true,
    passwordVersion: 1,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    get passwordHash() { return hashPassword(MANORS_ADMIN_DEMO_PASSWORD); },
    mfaSecretReference: null,
    mfaVerifiedAt: null,
    mfaRecoveryCodeHashes: [],
  },
  {
    id: MANORS_CHRIS_IDENTITY_ID,
    email: 'chris@managedcremations.test',
    normalizedEmail: 'chris@managedcremations.test',
    displayName: 'Chris',
    phone: null,
    status: 'active',
    emailVerified: true,
    passwordVersion: 1,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    get passwordHash() { return hashPassword(MANORS_ADMIN_DEMO_PASSWORD); },
    mfaSecretReference: null,
    mfaVerifiedAt: null,
    mfaRecoveryCodeHashes: [],
  },
  {
    id: MANORS_PRIYA_IDENTITY_ID,
    email: 'priya@managedcremations.test',
    normalizedEmail: 'priya@managedcremations.test',
    displayName: 'Priya',
    phone: null,
    status: 'active',
    emailVerified: true,
    passwordVersion: 1,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    get passwordHash() { return hashPassword(MANORS_ADMIN_DEMO_PASSWORD); },
    mfaSecretReference: null,
    mfaVerifiedAt: null,
    mfaRecoveryCodeHashes: [],
  },
];

export const membershipFixtures: Membership[] = [
  {
    id: MANORS_ADMIN_MEMBERSHIP_ID,
    identityId: MANORS_ADMIN_IDENTITY_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    role: 'administrator',
    status: 'active',
    invitedBy: null,
    joinedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: MANORS_CHRIS_MEMBERSHIP_ID,
    identityId: MANORS_CHRIS_IDENTITY_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    role: 'manager',
    status: 'active',
    invitedBy: MANORS_ADMIN_IDENTITY_ID,
    joinedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: MANORS_PRIYA_MEMBERSHIP_ID,
    identityId: MANORS_PRIYA_IDENTITY_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    role: 'officeStaff',
    status: 'active',
    invitedBy: MANORS_ADMIN_IDENTITY_ID,
    joinedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const identitySessionFixtures: IdentitySession[] = [];
export const emailVerificationTokenFixtures: EmailVerificationToken[] = [];
export const passwordResetTokenFixtures: PasswordResetToken[] = [];
export const loginActivityEventFixtures: LoginActivityEvent[] = [];
