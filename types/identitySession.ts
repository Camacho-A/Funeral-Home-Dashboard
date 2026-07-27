/**
 * Phase 21 (Identity, Authentication & Session Management). The
 * server-side session *registry* row — distinct from `types/auth.ts`'s
 * `AuthSession` (the stateless, signed JWT-like cookie payload). The
 * cookie alone can prove "this token was validly issued and hasn't
 * expired," but it can't be revoked before its own expiry, can't support
 * "sign out everywhere," and can't be listed as a device to the user —
 * all of which require a real, queryable row. `AUTH_ADAPTER='identity'`
 * sessions are validated by *both*: the cookie's signature/expiry
 * (`lib/auth/sessionToken.ts`, unchanged), and this row's own
 * `revokedAt`/`expiresAt`/`passwordVersionAtIssue` (see
 * `lib/auth/resolveIdentitySession.ts`). `AUTH_ADAPTER='mock'|'wix'`
 * sessions never create or read one of these at all.
 */
export type IdentitySession = {
  id: string;
  identityId: string;
  /** Which organization this session is *currently* viewing — mutable via
      "switch organization" (never baked into the signed cookie itself,
      matching the pre-existing "never trust organizationId supplied by
      the browser" principle: every request re-derives it from this row,
      not from anything the client claims). Null until the identity picks
      one (e.g. immediately after login, before any organization is
      selected). */
  organizationId: string | null;
  deviceId: string;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** Sliding — extended on every validated request, up to a hard
      re-authentication ceiling enforced by the cookie's own expiry. */
  expiresAt: string;
  lastSeenAt: string;
  rememberDevice: boolean;
  /** The identity's own `passwordVersion` at the moment this session was
      issued — a mismatch against the identity's *current* value means the
      password changed since, and this session is treated as invalid
      regardless of `revokedAt`/`expiresAt`. Not part of this phase's own
      literal `sessions` field list; added for the same reason
      `paymentRecords.idempotencyKey`/`onboardingSessions.idempotencyKey`
      were — see ADR-025. */
  passwordVersionAtIssue: number;
  revokedAt: string | null;
  createdAt: string;
};
