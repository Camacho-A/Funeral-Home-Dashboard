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

export const identityFixtures: MockIdentityRecord[] = [
  {
    id: MANORS_ADMIN_IDENTITY_ID,
    email: mockDefaultUser.email,
    normalizedEmail: mockDefaultUser.email.toLowerCase(),
    displayName: mockDefaultUser.displayName,
    status: 'active',
    emailVerified: true,
    passwordVersion: 1,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    passwordHash: hashPassword(MANORS_ADMIN_DEMO_PASSWORD),
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
];

export const identitySessionFixtures: IdentitySession[] = [];
export const emailVerificationTokenFixtures: EmailVerificationToken[] = [];
export const passwordResetTokenFixtures: PasswordResetToken[] = [];
export const loginActivityEventFixtures: LoginActivityEvent[] = [];
