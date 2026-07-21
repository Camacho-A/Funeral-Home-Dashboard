import { cookies } from 'next/headers';
import type { AuthSession } from '../../types/auth';
import { SESSION_COOKIE_NAME, createSessionToken, verifySessionToken } from './sessionToken';

/**
 * Phase 13 (Authentication & Organizations). The one Beacon session cookie
 * — server-managed, httpOnly, and the sole source of "is this browser
 * logged in." Both mock and wix login paths converge here: whichever one
 * authenticates the user, the result is the same kind of signed session
 * cookie (see lib/auth/sessionToken.ts), so nothing downstream (middleware,
 * layouts, the authorization resolver) needs to know or care which
 * identity provider was used.
 *
 * Real Wix access/refresh tokens are never stored in this cookie or any
 * other browser-visible location — see docs/AUTHENTICATION.md's security
 * notes and lib/auth/wixAuth.ts's own comment on why token persistence is
 * explicitly out of this phase's scope.
 */

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    // Matches sessionToken.ts's own expiry — the cookie and the signed
    // payload inside it always expire together.
    maxAge: 60 * 60 * 12,
  };
}

/** Reads and verifies the current request's session cookie. Returns null
    for anything invalid (missing, malformed, tampered, expired) — see
    verifySessionToken's own comment on why this never distinguishes why. */
export async function getSession(): Promise<AuthSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Issues a fresh session and sets it as the response's session cookie.
    Server Actions/Route Handlers only — cookies() can't be mutated from a
    Server Component during render. */
export async function createSession(user: AuthSession['user']): Promise<void> {
  const token = await createSessionToken(user);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, cookieOptions());
}

/** Logout. Clears the cookie outright rather than setting an empty value,
    so nothing verifiable is left for a subsequent request to find. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
