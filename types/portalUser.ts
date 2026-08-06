/**
 * Phase 29 (Family Portal & External Collaboration). A Family Portal
 * user's own login identity — **deliberately not** `types/identity.ts`'s
 * `Identity`, and never backed by the `identities` Wix collection.
 *
 * This is the single most load-bearing decision this phase makes: a
 * `PortalUser` and a staff `Identity` are two physically disjoint
 * populations, living in two different collections. A `PortalUser` can
 * never appear in `Membership`, RBAC resolution, or the staff
 * organization-switching flow — not because any code checks for that and
 * refuses it, but because those systems only ever read from `identities`/
 * `organizationMemberships`, which a `PortalUser` never touches at all.
 *
 * Reuses only the pure `lib/identity/passwordHashing.ts` hashing
 * functions — never `services/identityService.ts` itself. Password
 * reset uses its own `passwordResetTokenHash`/`passwordResetExpiresAt`
 * fields on this row, never the staff `passwordResetTokens` collection
 * (same reasoning: no shared collection, no shared code path).
 */
export type PortalUserStatus = 'active' | 'disabled';

export type PortalUser = {
  id: string;
  email: string;
  /** Lowercased, the actual lookup key — mirrors `Identity.normalizedEmail`'s
      own convention (see `domain/identity/email.ts`'s `normalizeEmail`). */
  normalizedEmail: string;
  displayName: string;
  passwordHash: string;
  emailVerified: boolean;
  status: PortalUserStatus;
  passwordResetTokenHash: string | null;
  passwordResetExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};
