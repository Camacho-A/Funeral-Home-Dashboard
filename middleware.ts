import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/sessionToken';
import { FAMILY_SESSION_COOKIE_NAME, verifyFamilySessionToken } from '@/lib/auth/familySessionToken';

/**
 * Phase 13 (Authentication & Organizations). The server-side gate for
 * every protected portal route — "do not use client-side route guards as
 * the only security boundary" is satisfied here structurally: this runs
 * before any page component (client or server) executes at all, so there
 * is no code path that reaches a portal page without a verified session.
 *
 * Deliberately imports only from lib/auth/sessionToken.ts (Web Crypto
 * only) and not lib/auth/session.ts (which depends on next/headers's
 * cookies() — not the API surface Middleware uses) or lib/env.ts's
 * Wix-specific functions — this keeps the middleware bundle minimal and
 * runtime-agnostic (works under both the edge and nodejs middleware
 * runtimes without special configuration).
 *
 * The `next` parameter preserves the intended destination through login —
 * see lib/auth/redirect.ts's sanitizeRedirectPath, which the login page
 * and its Server Action both apply again before actually redirecting
 * there, since a query parameter is still untrusted input even though
 * it's constructed here.
 *
 * Phase 29 (Family Portal & External Collaboration): `/family/*` pages
 * are gated by a structurally separate branch — the family session
 * cookie (`beacon_family_session`), verified by
 * `lib/auth/familySessionToken.ts`'s own Web-Crypto-only verifier
 * (mirrors `sessionToken.ts`'s own edge-safety exactly, and is a fully
 * independent module — see `lib/auth/sessionIsolation.test.ts`). Never
 * the staff `SESSION_COOKIE_NAME`/`verifySessionToken`, and never
 * redirected to `/login` — a missing/invalid family session redirects to
 * `/family/login` instead. The staff branch below never even inspects a
 * `/family/*` request's cookies.
 */
const FAMILY_PUBLIC_PATHS = ['/family/login', '/family/accept-invitation', '/family/forgot-password', '/family/reset-password'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/family')) {
    if (FAMILY_PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return NextResponse.next();
    }

    const familyToken = request.cookies.get(FAMILY_SESSION_COOKIE_NAME)?.value;
    const familySession = familyToken ? await verifyFamilySessionToken(familyToken) : null;

    if (!familySession) {
      const familyLoginUrl = new URL('/family/login', request.url);
      familyLoginUrl.searchParams.set('next', pathname + request.nextUrl.search);
      return NextResponse.redirect(familyLoginUrl);
    }

    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Phase 21 (Identity, Authentication & Session Management) adds the four
  // new public identity pages (forgot/reset password, verify email, accept
  // invitation) alongside /login — every one of them is reached by someone
  // who, by definition, has no valid session yet.
  //
  // Phase 26 (Electronic Signatures & Authorization Workflows) adds /sign —
  // architecturally distinct from every route above: those four all
  // eventually mint a Beacon session for the person using them; /sign never
  // does, for anyone, ever (see services/signatureService.ts's own header
  // comment). The signer is authenticated purely by the token in the URL,
  // validated entirely by /api/signing/* (already outside this matcher,
  // since /api/* is excluded wholesale) — this line only needs to let the
  // *page* itself render without a session redirect.
  //
  // Phase 29 (Family Portal & External Collaboration): `/family` is
  // deliberately NOT excluded here — unlike /sign, it needs its own
  // session check (the branch above), not a free pass. Only its own
  // public sub-paths (login/accept-invitation/forgot-password/reset-password)
  // skip the check, handled inside the middleware function itself.
  matcher: [
    '/((?!api|login|forgot-password|reset-password|verify-email|accept-invitation|sign|_next/static|_next/image|favicon.ico).*)',
  ],
};
