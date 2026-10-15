import { cookies } from 'next/headers';
// Registers request-scoped memoization (lib/requestMemo.ts) on the server;
// every authenticated server path loads this module.
import '../requestScope';
import type { AuthSession } from '../../types/auth';
import { SESSION_COOKIE_NAME, createSessionToken, verifySessionToken, sessionDurationSecondsFor } from './sessionToken';

/**
 * Phase 13 (Authentication & Organizations). The one Solis session cookie
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

function cookieOptions(source: AuthSession['user']['source']) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    // Matches sessionToken.ts's own expiry (sessionDurationSecondsFor) — the
    // cookie and the signed payload inside it always expire together.
    maxAge: sessionDurationSecondsFor(source),
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

/** Issues a fresh session and sets it as the response's session cookie —
    every call creates a brand-new signed token, which is what makes this
    the mechanism behind "session rotation after authentication"/"after
    password reset": callers never mutate an existing cookie, they always
    call this again. Server Actions/Route Handlers only — cookies() can't
    be mutated from a Server Component during render. `sessionId` (Phase
    21) links an `'identity'`-source session to its server-side registry
    row — see lib/auth/sessionToken.ts's own comment. */
export async function createSession(user: AuthSession['user'], sessionId?: string): Promise<void> {
  const token = await createSessionToken(user, undefined, sessionId);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, cookieOptions(user.source));
}

/** Logout. Clears the cookie outright rather than setting an empty value,
    so nothing verifiable is left for a subsequent request to find. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

/**
 * Stale/invalid-session handling (2026-10). A Server Component (e.g. the
 * portal layout) must never mutate cookies during render — Next.js throws
 * "Cookies can only be modified in a Server Action or Route Handler". So a
 * layout that finds the session cookie unusable redirects to this Route
 * Handler instead, which deletes the cookie and then sends the browser to
 * `/login?error=<reason>`.
 *
 * `reason` travels through a URL, so it is validated against this fixed
 * allowlist on BOTH ends: the handler never echoes an arbitrary value, and
 * only ever redirects to the fixed internal `/login` path (no open
 * redirect).
 */
export const CLEAR_SESSION_ROUTE = '/api/auth/clear-session';

export const CLEAR_SESSION_REASONS = [
  'missing_session_id',
  'session_not_found',
  'revoked',
  'expired',
  'password_changed',
  'identity_not_found',
  'identity_not_active',
  'auth_adapter_not_allowed',
  'organization_not_allowed',
] as const;

export type ClearSessionReason = (typeof CLEAR_SESSION_REASONS)[number];

export const DEFAULT_CLEAR_SESSION_REASON: ClearSessionReason = 'session_not_found';

export function isClearSessionReason(value: unknown): value is ClearSessionReason {
  return typeof value === 'string' && (CLEAR_SESSION_REASONS as readonly string[]).includes(value);
}

/** The internal path a Server Component redirects to when its session
    cookie must be discarded. Unknown reasons collapse to the default. */
export function clearSessionPath(reason: string): string {
  const safeReason = isClearSessionReason(reason) ? reason : DEFAULT_CLEAR_SESSION_REASON;
  return `${CLEAR_SESSION_ROUTE}?reason=${safeReason}`;
}
