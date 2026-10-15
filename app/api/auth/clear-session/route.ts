import { NextResponse } from 'next/server';
import { getSession, isClearSessionReason, DEFAULT_CLEAR_SESSION_REASON } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/sessionToken';
import { resolveIdentitySession } from '@/lib/auth/resolveIdentitySession';
import { getDataAdapterMode } from '@/lib/env';
import { isNonIdentityAuthorizationPermitted } from '@/lib/auth/authorize';
import type { AuthSession } from '@/types/auth';

/**
 * GET /api/auth/clear-session?reason=<reason> (2026-10).
 *
 * Where a Server Component sends the browser when its session cookie is
 * unusable (see lib/auth/session.ts's CLEAR_SESSION_ROUTE comment): Server
 * Components cannot modify cookies during render, a Route Handler can.
 *
 * Safety properties:
 * - Only ever redirects to the fixed internal path `/login` — nothing in
 *   the request chooses the destination (no open redirect).
 * - `reason` is checked against a fixed allowlist; anything else becomes
 *   the generic `session_not_found`.
 * - The cookie is deleted only when the session really is unusable
 *   (missing/unverifiable, an identity session that no longer resolves, or
 *   a mock/wix-login session against real Wix data). A still-valid session
 *   is left untouched, so a cross-site link to this GET cannot sign anyone
 *   out (no logout CSRF), and the redirect still lands on `/login`, which
 *   never bounces back — no redirect loop either way.
 */
export async function GET(request: Request) {
  const rawReason = new URL(request.url).searchParams.get('reason');
  const reason = isClearSessionReason(rawReason) ? rawReason : DEFAULT_CLEAR_SESSION_REASON;

  const session = await getSession();
  const unusable = session === null || (await isSessionUnusable(session));

  const response = NextResponse.redirect(new URL(`/login?error=${reason}`, request.url), 303);
  response.headers.set('Cache-Control', 'no-store');
  if (unusable) {
    response.cookies.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }
  return response;
}

async function isSessionUnusable(session: AuthSession): Promise<boolean> {
  if (session.user.source !== 'identity') {
    return !isNonIdentityAuthorizationPermitted();
  }
  const resolved = await resolveIdentitySession(session, getDataAdapterMode());
  return !resolved.valid;
}
