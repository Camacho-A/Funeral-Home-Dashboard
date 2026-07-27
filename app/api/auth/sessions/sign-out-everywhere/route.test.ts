import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `sign-out-everywhere-route-test-${idCounter}`;
}

let mockSession: unknown = null;
const clearSessionMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: clearSessionMock,
}));

const { POST } = await import('./route');

function postRequest(headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/auth/sessions/sign-out-everywhere', { method: 'POST', headers }));
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

describe('POST /api/auth/sessions/sign-out-everywhere', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    expect((await postRequest()).status).toBe(401);
  });

  it('revokes every session for the identity, including the current one, and clears the cookie', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { createIdentitySession, listActiveSessionsForIdentity } = await import('@/services/sessionService');
    const { identity } = await findOrCreateIdentity({ email: 'signout.everywhere@example.com', displayName: 'Sign Out Everywhere', idFactory }, 'mock');
    await updateIdentity(identity.id, { status: 'active' }, 'mock');
    const current = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
    await createIdentitySession({ identityId: identity.id, deviceId: 'd2', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
    mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: current.id };

    const response = await postRequest();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revokedCount).toBe(2);
    expect(await listActiveSessionsForIdentity(identity.id, 'mock')).toHaveLength(0);
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });
});
