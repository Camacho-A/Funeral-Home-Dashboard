import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { portalUserFixtures, portalSessionFixtures } from '@/services/__mocks__/portalFixtures';
import { resetRateLimiter } from '@/lib/rateLimiter';
import { hashPassword, verifyPassword } from '@/lib/identity/passwordHashing';

const { POST } = await import('./route');
const { requestPortalPasswordReset, findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
const { createPortalSession } = await import('@/services/portal/portalSessionService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-reset-password-route-test-${idCounter}`;
}

function resetRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/family/reset-password', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let lengths: { users: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  resetRateLimiter();
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
});

describe('POST /api/family/reset-password', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await resetRequest({ token: 'x', password: 'Password123!' }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('rejects a too-short password', async () => {
    const response = await resetRequest({ token: 'x', password: 'short' });
    expect(response.status).toBe(400);
  });

  it('rejects an unknown token without distinguishing why', async () => {
    const response = await resetRequest({ token: 'not-a-real-token', password: 'Password123!' });
    expect(response.status).toBe(400);
  });

  it('resets the password, revokes every existing PortalSession, and never leaks the new hash', async () => {
    const { generateToken } = await import('@/lib/identity/tokens');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-reset@example.com', displayName: 'Pat Family', passwordHash: hashPassword('OldPassword1!'), idFactory },
      'mock',
    );
    const oldSession = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    const { token, tokenHash } = generateToken();
    await requestPortalPasswordReset({ email: 'family-reset@example.com', tokenHash, expiresAt: '2026-12-31T00:00:00.000Z' }, 'mock');

    const response = await resetRequest({ token, password: 'NewPassword1!' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const reloaded = portalUserFixtures.find((u) => u.id === portalUser.id)!;
    expect(verifyPassword('NewPassword1!', reloaded.passwordHash)).toBe(true);
    expect(verifyPassword('OldPassword1!', reloaded.passwordHash)).toBe(false);

    const reloadedSession = portalSessionFixtures.find((s) => s.id === oldSession.id)!;
    expect(reloadedSession.revokedAt).not.toBeNull();
  });

  it('rate-limits repeated attempts from the same IP', async () => {
    for (let i = 0; i < 10; i += 1) {
      await resetRequest({ token: 'bad-token', password: 'Password123!' });
    }
    const response = await resetRequest({ token: 'bad-token', password: 'Password123!' });
    expect(response.status).toBe(429);
  });
});
