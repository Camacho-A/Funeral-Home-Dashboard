/**
 * Phase 13 (Authentication & Organizations). See docs/AUTHENTICATION.md for
 * the full flow and docs/adr/ADR-008-authentication-and-organizations.md
 * for why this shape.
 */

/**
 * A logged-in Beacon user — deliberately separate from Wix's own `Member`
 * type (never imported into this type directly). `source` distinguishes a
 * mock identity from a real Wix member without either code or a test ever
 * needing to guess from the shape of `id` alone — a mock id and a real Wix
 * member `_id` are both plain strings.
 */
export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  source: 'mock' | 'wix';
};

/**
 * The server-issued, signed session — see lib/auth/sessionToken.ts for how
 * this is encoded into an httpOnly cookie. Deliberately does not carry an
 * organizationId: which organization(s) this user can access is resolved
 * separately, from trusted membership data, never baked into the session
 * itself (see types/authorization.ts).
 */
export type AuthSession = {
  user: AuthenticatedUser;
  issuedAt: number; // epoch seconds
  expiresAt: number; // epoch seconds
};
