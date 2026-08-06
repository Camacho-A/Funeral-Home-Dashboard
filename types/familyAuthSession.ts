/**
 * Phase 29 (Family Portal & External Collaboration). The signed payload
 * inside the `beacon_family_session` cookie — see
 * `lib/auth/familySessionToken.ts`. Structurally distinct from
 * `types/auth.ts`'s `AuthSession`: no `source` field (a family session is
 * never `'mock'`/`'wix'`/`'identity'`), an always-present `sessionId` (a
 * family session always has a corresponding `PortalSession` row — never
 * optional, unlike `AuthSession.sessionId`), and an explicit `aud: 'family'`
 * token-audience claim that `lib/auth/familySessionToken.ts`'s verifier
 * checks explicitly, so a validly-signed staff token could never be
 * misread as a family one even if the two ever accidentally shared a key.
 */
export type FamilySessionPayload = {
  portalUserId: string;
  sessionId: string;
  aud: 'family';
  issuedAt: number; // epoch seconds
  expiresAt: number; // epoch seconds
};
