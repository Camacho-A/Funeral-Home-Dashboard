import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
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
