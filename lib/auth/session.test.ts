import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = new Map<string, { value: string; options?: Record<string, unknown> }>();

// next/headers's cookies() requires a live Next.js request context that a
// plain Vitest test doesn't have — mocked here with an in-memory Map that
// behaves like the subset of the real cookie jar's API (get/set/delete)
// that lib/auth/session.ts actually calls, so its real logic (not a
// reimplementation of it) is what's under test. `options` is captured too
// (not just `value`) so the session-duration fix's per-source `maxAge` is
// actually observable from a test, not just the cookie's value.
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieStore.set(name, { value, options });
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  })),
}));

const { getSession, createSession, clearSession } = await import('./session');
const { SESSION_COOKIE_NAME } = await import('./sessionToken');
const testUser = {
  id: 'mock-user-dana',
  email: 'dana@managedcremations.test',
  displayName: 'Dana',
  source: 'mock' as const,
};
const identityTestUser = {
  id: 'identity-dana',
  email: 'dana@managedcremations.test',
  displayName: 'Dana',
  source: 'identity' as const,
};

describe('session cookie lifecycle', () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it('getSession returns null when no cookie is set', async () => {
    expect(await getSession()).toBeNull();
  });

  it('createSession then getSession round-trips the user — this is "session restoration after refresh"', async () => {
    await createSession(testUser);
    const session = await getSession();
    expect(session?.user).toEqual(testUser);
  });

  it('clearSession removes the cookie so getSession returns null again — this is "logout"', async () => {
    await createSession(testUser);
    await clearSession();

    expect(await getSession()).toBeNull();
    expect(cookieStore.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it('sets the unchanged 12-hour cookie maxAge for a mock/wix session (Solis session-timeout fix, 2026-09)', async () => {
    await createSession(testUser);
    expect(cookieStore.get(SESSION_COOKIE_NAME)?.options?.maxAge).toBe(60 * 60 * 12);
  });

  it('sets a 30-day cookie maxAge for an identity-mode session — the actual session-timeout fix', async () => {
    await createSession(identityTestUser, 'identity-session-1');
    expect(cookieStore.get(SESSION_COOKIE_NAME)?.options?.maxAge).toBe(60 * 60 * 24 * 30);
  });
});
