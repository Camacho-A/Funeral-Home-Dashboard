import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `sessions-list-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { GET } = await import('./route');

let lengths: { identity: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = { identity: identityFixtures.length, sessions: identitySessionFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  identitySessionFixtures.length = lengths.sessions;
});

describe('GET /api/auth/sessions', () => {
  it('returns 401 with no session', async () => {
    expect((await GET()).status).toBe(401);
  });

  it('lists every active session for the identity, marking the current one', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { createIdentitySession } = await import('@/services/sessionService');
    const { identity } = await findOrCreateIdentity({ email: 'sessions.list@example.com', displayName: 'Sessions List', idFactory }, 'mock');
    await updateIdentity(identity.id, { status: 'active' }, 'mock');

    const current = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
    await createIdentitySession({ identityId: identity.id, deviceId: 'd2', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');

    mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: current.id };

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.find((s: { id: string }) => s.id === current.id).isCurrent).toBe(true);
    expect(body.sessions.filter((s: { isCurrent: boolean }) => s.isCurrent)).toHaveLength(1);
  });
});
