import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/sessionToken';

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
 */
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
};
