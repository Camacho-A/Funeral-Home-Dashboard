import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { portalSessionFixtures } from '../__mocks__/portalFixtures';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `portal-session-test-${idCounter}`;
}

let originalLength: number;
beforeEach(() => {
  idCounter = 0;
  originalLength = portalSessionFixtures.length;
});
afterEach(() => {
  portalSessionFixtures.length = originalLength;
});

describe('portalSessionService', () => {
  it('createPortalSession creates a fresh, unrevoked session', async () => {
    const { createPortalSession } = await import('./portalSessionService');
    const session = await createPortalSession({ portalUserId: 'portal-user-1', deviceId: 'device-1', idFactory }, 'mock');

    expect(session.portalUserId).toBe('portal-user-1');
    expect(session.revokedAt).toBeNull();
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('getSessionById returns null for an unknown id', async () => {
    const { getSessionById } = await import('./portalSessionService');
    expect(await getSessionById('no-such-session', 'mock')).toBeNull();
  });

  it('listActiveSessionsForPortalUser excludes revoked and expired sessions', async () => {
    const { createPortalSession, listActiveSessionsForPortalUser, revokeSession } = await import('./portalSessionService');
    const active = await createPortalSession({ portalUserId: 'portal-user-2', deviceId: 'device-a', idFactory }, 'mock');
    const revoked = await createPortalSession({ portalUserId: 'portal-user-2', deviceId: 'device-b', idFactory }, 'mock');
    await revokeSession(revoked.id, 'mock');

    const expired = await createPortalSession({ portalUserId: 'portal-user-2', deviceId: 'device-c', idFactory }, 'mock');
    const record = portalSessionFixtures.find((s) => s.id === expired.id)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();

    const list = await listActiveSessionsForPortalUser('portal-user-2', 'mock');
    expect(list.map((s) => s.id)).toEqual([active.id]);
  });

  it('touchSession slides expiresAt forward and bumps lastSeenAt', async () => {
    const { createPortalSession, touchSession } = await import('./portalSessionService');
    const session = await createPortalSession({ portalUserId: 'portal-user-3', deviceId: 'device-1', idFactory }, 'mock');
    const originalExpiry = session.expiresAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const touched = await touchSession(session.id, 'mock');

    expect(new Date(touched!.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(originalExpiry).getTime());
  });

  it('revokeSession sets revokedAt and removes the session from the active list', async () => {
    const { createPortalSession, revokeSession, listActiveSessionsForPortalUser } = await import('./portalSessionService');
    const session = await createPortalSession({ portalUserId: 'portal-user-4', deviceId: 'device-1', idFactory }, 'mock');
    await revokeSession(session.id, 'mock');

    const list = await listActiveSessionsForPortalUser('portal-user-4', 'mock');
    expect(list).toHaveLength(0);
  });

  it('revokeAllSessionsForPortalUser revokes every session except an optionally excluded one', async () => {
    const { createPortalSession, revokeAllSessionsForPortalUser, listActiveSessionsForPortalUser } = await import('./portalSessionService');
    const keep = await createPortalSession({ portalUserId: 'portal-user-5', deviceId: 'device-keep', idFactory }, 'mock');
    await createPortalSession({ portalUserId: 'portal-user-5', deviceId: 'device-revoke-1', idFactory }, 'mock');
    await createPortalSession({ portalUserId: 'portal-user-5', deviceId: 'device-revoke-2', idFactory }, 'mock');

    const revokedCount = await revokeAllSessionsForPortalUser('portal-user-5', 'mock', keep.id);
    expect(revokedCount).toBe(2);

    const remaining = await listActiveSessionsForPortalUser('portal-user-5', 'mock');
    expect(remaining.map((s) => s.id)).toEqual([keep.id]);
  });
});
