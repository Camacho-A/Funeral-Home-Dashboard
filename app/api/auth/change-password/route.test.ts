import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `change-password-route-test-${idCounter}`;
}

let mockSession: unknown = null;
const clearSessionMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: clearSessionMock,
}));

const { POST } = await import('./route');

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/auth/change-password', { method: 'POST', headers, body: JSON.stringify(body) }));
}

async function seedLoggedInIdentity(email: string, password: string) {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { setPassword } = await import('@/services/passwordService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity: created } = await findOrCreateIdentity({ email, displayName: 'Change Password Test', idFactory }, 'mock');
  await updateIdentity(created.id, { status: 'active' }, 'mock');
  await setPassword(created.id, password, 'mock');
  const { getIdentityById } = await import('@/services/identityService');
  const identity = (await getIdentityById(created.id, 'mock'))!;
  const identitySession = await createIdentitySession(
    { identityId: identity.id, deviceId: 'device-1', rememberDevice: false, passwordVersionAtIssue: identity.passwordVersion, idFactory },
    'mock',
  );
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: identitySession.id };
  return { identity, identitySession };
}

let lengths: { identity: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  clearSessionMock.mockClear();
  lengths = { identity: identityFixtures.length, sessions: identitySessionFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  identitySessionFixtures.length = lengths.sessions;
});

describe('POST /api/auth/change-password', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ currentPassword: 'x', newPassword: 'NewPassword1!' }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no identity session', async () => {
    expect((await postRequest({ currentPassword: 'x', newPassword: 'NewPassword1!' })).status).toBe(401);
  });

  it('rejects an incorrect current password', async () => {
    await seedLoggedInIdentity('wrongcurrent@example.com', 'RealPassword1!');
    const response = await postRequest({ currentPassword: 'WrongPassword', newPassword: 'NewPassword1!' });
    expect(response.status).toBe(400);
  });

  it('changes the password and signs out everywhere (including this session) by default', async () => {
    const { identity, identitySession } = await seedLoggedInIdentity('signoutall@example.com', 'RealPassword1!');
    const { verifyPassword } = await import('@/services/passwordService');
    const { listActiveSessionsForIdentity } = await import('@/services/sessionService');

    const response = await postRequest({ currentPassword: 'RealPassword1!', newPassword: 'NewPassword1!' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.signedOutEverywhere).toBe(true);

    expect(await verifyPassword(identity.id, 'NewPassword1!', 'mock')).toBe(true);
    expect(await listActiveSessionsForIdentity(identity.id, 'mock')).toHaveLength(0);
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
    void identitySession;
  });

  it('keeps the current session alive when keepCurrentSession is explicitly requested', async () => {
    const { identity, identitySession } = await seedLoggedInIdentity('keepcurrent@example.com', 'RealPassword1!');
    const { listActiveSessionsForIdentity } = await import('@/services/sessionService');

    const response = await postRequest({ currentPassword: 'RealPassword1!', newPassword: 'NewPassword1!', keepCurrentSession: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.signedOutEverywhere).toBe(false);

    const remaining = await listActiveSessionsForIdentity(identity.id, 'mock');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(identitySession.id);
    expect(clearSessionMock).not.toHaveBeenCalled();

    // The kept session must actually still resolve — not just appear in
    // the active list — otherwise resolveIdentitySession's own
    // password-version check would silently reject it on its next use.
    const { resolveIdentitySession } = await import('@/lib/auth/resolveIdentitySession');
    const resolved = await resolveIdentitySession(
      { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sessionId: identitySession.id },
      'mock',
    );
    expect(resolved.valid).toBe(true);
  });
});
