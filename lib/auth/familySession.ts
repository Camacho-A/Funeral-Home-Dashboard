import { cookies } from 'next/headers';
import type { FamilySessionPayload } from '../../types/familyAuthSession';
import { FAMILY_SESSION_COOKIE_NAME, createFamilySessionToken, verifyFamilySessionToken } from './familySessionToken';

/**
 * Phase 29 (Family Portal & External Collaboration). The one Family Portal
 * session cookie — server-managed, httpOnly, structurally isolated from
 * `lib/auth/session.ts`'s staff `beacon_session` cookie: different name,
 * different signing key derivation (see familySessionToken.ts), different
 * resolver (`requireFamilySession.ts`). Never imported by any staff-side
 * code, never imports any staff-side session code — see
 * `lib/auth/sessionIsolation.test.ts`.
 */

function familyCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    // Matches familySessionToken.ts's own expiry — the cookie and the
    // signed payload inside it always expire together.
    maxAge: 60 * 60 * 24 * 30,
  };
}

/** Reads and verifies the current request's family session cookie.
    Returns null for anything invalid — see verifyFamilySessionToken's own
    comment on why this never distinguishes why. */
export async function getFamilySession(): Promise<FamilySessionPayload | null> {
  const store = await cookies();
  const token = store.get(FAMILY_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyFamilySessionToken(token);
}

/** Issues a fresh family session and sets it as the response's cookie.
    Every call creates a brand-new signed token — see acceptance flow
    (`portalInvitationService.ts`), which always mints a fresh session
    rather than reusing one (refinement #13: never extend an existing
    session at acceptance time). Server Actions/Route Handlers only. */
export async function createFamilySession(params: { portalUserId: string; sessionId: string }): Promise<void> {
  const token = await createFamilySessionToken(params);
  const store = await cookies();
  store.set(FAMILY_SESSION_COOKIE_NAME, token, familyCookieOptions());
}

/** Family logout. Clears the cookie outright rather than setting an empty
    value, mirroring clearSession()'s own reasoning. */
export async function clearFamilySession(): Promise<void> {
  const store = await cookies();
  store.delete(FAMILY_SESSION_COOKIE_NAME);
}
