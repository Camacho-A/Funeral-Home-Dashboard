/**
 * Phase 21 (Identity, Authentication & Session Management). A real,
 * Beacon-owned identity — distinct from `types/auth.ts`'s
 * `AuthenticatedUser` (the *session's* view of who's logged in, which can
 * be backed by a mock fixture, a Wix Member, or — as of this phase — an
 * `Identity`) and from the pre-existing mock-only `OrganizationMembership`
 * (`types/organization.ts`), which `AUTH_ADAPTER='mock'|'wix'` sessions
 * keep using entirely unchanged. `Identity` answers "who is this person,"
 * full stop — never which organizations they belong to or what they can
 * do there; see `types/membership.ts` and ADR-025's "Identity and
 * authorization must remain separate."
 *
 * Deliberately excludes any password/secret material — this type is safe
 * to pass around freely (returned from API routes, held in React state).
 * The password hash, MFA `secretReference`, and recovery-code hashes live
 * on the same underlying Wix row but are only ever read/written by
 * `services/passwordService.ts`/`services/mfaService.ts` through their own
 * narrow, dedicated functions — never included in `Identity` itself.
 */
export type IdentityStatus = 'pending' | 'active' | 'locked' | 'disabled' | 'deleted';

export type Identity = {
  id: string;
  email: string;
  /** Lowercased, trimmed — the value every lookup/uniqueness check
      actually keys on (see domain/identity/email.ts's normalizeEmail).
      `email` itself preserves the user's original casing for display. */
  normalizedEmail: string;
  displayName: string;
  status: IdentityStatus;
  emailVerified: boolean;
  /** Incremented every time the password changes — the mechanism behind
      "changing a password invalidates all previous sessions." Never
      decremented. */
  passwordVersion: number;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Internal-only shape for the secret-adjacent fields that live on the same
 * Wix row as `Identity` but are never part of the public type above.
 * Returned only by `services/passwordService.ts`/`services/mfaService.ts`'s
 * own narrow accessors — see `lib/wixIdentityMapper.ts`'s own comment on
 * why these are mapped separately.
 */
export type IdentitySecrets = {
  passwordHash: string | null;
  mfaSecretReference: string | null;
  mfaVerifiedAt: string | null;
  mfaRecoveryCodeHashes: string[];
};
