import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware, config } from './middleware';
import { createSessionToken, SESSION_COOKIE_NAME } from './lib/auth/sessionToken';
import type { AuthenticatedUser } from './types/auth';

const testUser: AuthenticatedUser = {
  id: 'mock-user-dana',
  email: 'dana@managedcremations.test',
  displayName: 'Dana',
  source: 'mock',
};

function requestFor(path: string, cookieValue?: string): NextRequest {
  const headers = new Headers();
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE_NAME}=${cookieValue}`);
  return new NextRequest(new Request(`http://localhost:3000${path}`, { headers }));
}

describe('middleware — unauthenticated access to protected routes', () => {
  it('redirects to /login when there is no session cookie at all', async () => {
    const response = await middleware(requestFor('/dashboard'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
  });

  it('preserves the intended destination in the next parameter', async () => {
    const response = await middleware(requestFor('/cases/1042'));

    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('next')).toBe('/cases/1042');
  });

  it('redirects when the session cookie is present but invalid (tampered/expired/garbage)', async () => {
    const response = await middleware(requestFor('/dashboard', 'not-a-real-token'));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
  });
});

describe('middleware — authenticated access', () => {
  it('allows the request through when the session cookie is valid', async () => {
    const token = await createSessionToken(testUser);
    const response = await middleware(requestFor('/dashboard', token));

    // NextResponse.next() carries no redirect — status is the pass-through default.
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('middleware — invalid or expired session handling', () => {
  it('rejects an expired session even though the cookie value is well-formed', async () => {
    const longAgo = 1_000_000;
    const token = await createSessionToken(testUser, longAgo);
    // The token embeds its own expiry, so no need to mock "now" here — this
    // token expired 12h after `longAgo`, which is far in the past already.
    const response = await middleware(requestFor('/dashboard', token));

    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
  });
});

describe('Phase 26 (Electronic Signatures & Authorization Workflows) — /sign matcher exclusion', () => {
  // config.matcher is applied by Next.js itself *before* middleware() is ever
  // invoked for a matching path — middleware() has no way to observe that
  // exclusion from the inside, so the regex itself is tested directly here,
  // matching every other public-page path's own exclusion in the same list.
  const matcherPattern = new RegExp(config.matcher[0]);

  it('excludes /sign — the public signing page never gets a session redirect', () => {
    expect(matcherPattern.test('/sign')).toBe(false);
  });

  it('still protects every other portal path exactly as before', () => {
    expect(matcherPattern.test('/dashboard')).toBe(true);
    expect(matcherPattern.test('/cases/1042')).toBe(true);
    expect(matcherPattern.test('/settings')).toBe(true);
  });

  it('still excludes every pre-existing public path', () => {
    expect(matcherPattern.test('/login')).toBe(false);
    expect(matcherPattern.test('/forgot-password')).toBe(false);
    expect(matcherPattern.test('/verify-email')).toBe(false);
    expect(matcherPattern.test('/accept-invitation')).toBe(false);
  });
});

describe('Task #19 (2026-09) — /brand matcher exclusion (SOLIS logo on Login)', () => {
  // Root cause: an unauthenticated request for public/brand/soliscode-mark.png
  // (ProductBrand's <img src>) had no matcher exclusion, so it fell through to
  // this middleware's catch-all exactly like a protected page would and was
  // 307-redirected to /login?next=... — an HTML page, not an image, which is
  // what produced the missing/broken SOLIS logo specifically on the
  // logged-out Login screen.
  //
  // Anchored with ^...$ here (unlike the /sign block above) because
  // /brand/soliscode-mark.png contains a second "/" — an *unanchored*
  // RegExp#test() scans every position in the string for a match, so it
  // can find a spurious match starting right after that second "/" (where
  // the lookahead trivially passes against "soliscode-mark.png") even
  // though the real, intended match position — right after the leading
  // "/" — correctly fails the lookahead once "brand" is excluded. Next.js
  // itself compiles matcher patterns anchored to the whole pathname, so
  // this mirrors production's actual behavior; verified empirically
  // against the live production 307 response (§ root cause) before this
  // fix landed.
  const matcherPattern = new RegExp(`^${config.matcher[0]}$`);

  it('excludes the actual SOLIS mark asset path — no session redirect for the logo image request', () => {
    expect(matcherPattern.test('/brand/soliscode-mark.png')).toBe(false);
  });

  it('excludes the bare /brand path', () => {
    expect(matcherPattern.test('/brand')).toBe(false);
  });

  it('regression guard: middleware() itself has no /brand special case — calling it directly (bypassing the matcher, as a broken deploy config could) reproduces the exact pre-fix symptom, proving the real fix must live in config.matcher, not here', async () => {
    const response = await middleware(requestFor('/brand/soliscode-mark.png'));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
    // Next.js applies config.matcher *before* middleware() is ever invoked
    // for a matching path (see the /sign describe block's own comment
    // above) — so in real production traffic this function is simply never
    // reached for /brand/*. The matcher-level exclusion tested above is
    // what actually protects the logo request; this test only documents
    // that middleware() was never the place the fix belonged.
  });

  it('still protects every other portal path exactly as before', () => {
    expect(matcherPattern.test('/dashboard')).toBe(true);
    expect(matcherPattern.test('/cases/1042')).toBe(true);
    expect(matcherPattern.test('/settings')).toBe(true);
  });
});
