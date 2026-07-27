import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `sessions-delete-route-test-${idCounter}`;
}

let mockSession: unknown = null;
const clearSessionMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: clearSessionMock,
}));

const { DELETE } = await import('./route');

function deleteRequest(sessionId: string, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return DELETE(new Request(`http://localhost/api/auth/sessions/${sessionId}`, { method: 'DELETE', headers }), { params: Promise.resolve({ sessionId }) });
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

async function seedTwoSessions(email: string) {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email, displayName: 'Delete Session Test', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  const current = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  const other = await createIdentitySession({ identityId: identity.id, deviceId: 'd2', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: current.id };
  return { identity, current, other };
}

describe('DELETE /api/auth/sessions/[sessionId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await deleteRequest('whatever', { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    expect((await deleteRequest('whatever')).status).toBe(401);
  });

  it("revokes another one of the caller's own devices without clearing this browser's cookie", async () => {
    const { other } = await seedTwoSessions('delete.other@example.com');
    const response = await deleteRequest(other.id);
    expect(response.status).toBe(200);

    const { getSessionById } = await import('@/services/sessionService');
    expect((await getSessionById(other.id, 'mock'))?.revokedAt).not.toBeNull();
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('revoking this device\'s own current session also clears its cookie', async () => {
    const { current } = await seedTwoSessions('delete.self@example.com');
    const response = await deleteRequest(current.id);
    expect(response.status).toBe(200);
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for a session id that belongs to a different identity", async () => {
    await seedTwoSessions('delete.mine@example.com');
    const { findOrCreateIdentity } = await import('@/services/identityService');
    const { createIdentitySession } = await import('@/services/sessionService');
    const { identity: otherIdentity } = await findOrCreateIdentity({ email: 'someone.else@example.com', displayName: 'Someone Else', idFactory }, 'mock');
    const otherPersonsSession = await createIdentitySession({ identityId: otherIdentity.id, deviceId: 'd3', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');

    const response = await deleteRequest(otherPersonsSession.id);
    expect(response.status).toBe(404);

    const { getSessionById } = await import('@/services/sessionService');
    expect((await getSessionById(otherPersonsSession.id, 'mock'))?.revokedAt).toBeNull();
  });
});
