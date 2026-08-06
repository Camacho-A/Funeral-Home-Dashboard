import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = new Map<string, { value: string }>();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => {
      cookieStore.set(name, { value });
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  })),
}));

const { getFamilySession, createFamilySession, clearFamilySession } = await import('./familySession');
const { FAMILY_SESSION_COOKIE_NAME } = await import('./familySessionToken');
const params = { portalUserId: 'portal-user-1', sessionId: 'portal-session-1' };

describe('family session cookie lifecycle', () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it('getFamilySession returns null when no cookie is set', async () => {
    expect(await getFamilySession()).toBeNull();
  });

  it('createFamilySession then getFamilySession round-trips the portal user/session ids', async () => {
    await createFamilySession(params);
    const session = await getFamilySession();
    expect(session?.portalUserId).toBe(params.portalUserId);
    expect(session?.sessionId).toBe(params.sessionId);
  });

  it('clearFamilySession removes the cookie so getFamilySession returns null again — this is "family logout"', async () => {
    await createFamilySession(params);
    await clearFamilySession();

    expect(await getFamilySession()).toBeNull();
    expect(cookieStore.has(FAMILY_SESSION_COOKIE_NAME)).toBe(false);
  });

  it('uses a distinct cookie name from the staff session cookie', async () => {
    await createFamilySession(params);
    expect(cookieStore.has('beacon_session')).toBe(false);
    expect(cookieStore.has(FAMILY_SESSION_COOKIE_NAME)).toBe(true);
  });
});
