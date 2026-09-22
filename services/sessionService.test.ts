import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identitySessionFixtures } from './__mocks__/identityFixtures';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `session-test-${idCounter}`;
}

let lengthBefore: number;
beforeEach(() => {
  idCounter = 0;
  lengthBefore = identitySessionFixtures.length;
});
afterEach(() => {
  identitySessionFixtures.length = lengthBefore;
});

const BASE_PARAMS = {
  identityId: 'identity-x',
  deviceId: 'device-1',
  deviceName: 'Chrome on macOS',
  ipAddress: '203.0.113.5',
  userAgent: 'Mozilla/5.0',
  passwordVersionAtIssue: 1,
  idFactory,
};

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TOLERANCE_MS = 5000;

describe('createIdentitySession', () => {
  it('creates a session with no organization selected yet', async () => {
    const { createIdentitySession } = await import('./sessionService');
    const session = await createIdentitySession(BASE_PARAMS, 'mock');
    expect(session.organizationId).toBeNull();
    expect(session.revokedAt).toBeNull();
  });

  it('no longer carries a rememberDevice field — "Remember this device" was removed', async () => {
    const { createIdentitySession } = await import('./sessionService');
    const session = await createIdentitySession(BASE_PARAMS, 'mock');
    expect('rememberDevice' in session).toBe(false);
  });

  it('sets expiresAt to the 4-hour idle deadline on creation, since the 16-hour absolute cap is not yet binding', async () => {
    const { createIdentitySession } = await import('./sessionService');
    const before = Date.now();
    const session = await createIdentitySession(BASE_PARAMS, 'mock');
    const expected = before + 4 * HOUR_MS;
    expect(Math.abs(new Date(session.expiresAt).getTime() - expected)).toBeLessThan(TOLERANCE_MS);
  });
});

describe('setSessionOrganization', () => {
  it('sets the session\'s current organization context', async () => {
    const { createIdentitySession, setSessionOrganization } = await import('./sessionService');
    const session = await createIdentitySession(BASE_PARAMS, 'mock');
    const updated = await setSessionOrganization(session.id, 'org-1', 'mock');
    expect(updated?.organizationId).toBe('org-1');
  });
});

describe('touchSession (sliding expiration)', () => {
  it('extends expiresAt and updates lastSeenAt', async () => {
    const { createIdentitySession, touchSession } = await import('./sessionService');
    const session = await createIdentitySession(BASE_PARAMS, 'mock');
    const originalExpiry = session.expiresAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const touched = await touchSession(session.id, 'mock');
    expect(new Date(touched!.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(originalExpiry).getTime());
  });

  it('is throttled — a touch within 5 minutes of lastSeenAt is a no-op, not a fresh write', async () => {
    const { createIdentitySession, touchSession } = await import('./sessionService');
    const session = await createIdentitySession({ ...BASE_PARAMS, identityId: 'throttle-identity' }, 'mock');

    const touched = await touchSession(session.id, 'mock');
    expect(touched!.lastSeenAt).toBe(session.lastSeenAt);
    expect(touched!.expiresAt).toBe(session.expiresAt);
  });

  it('past the throttle window, extends the idle deadline to lastSeenAt + 4 hours', async () => {
    const { createIdentitySession, touchSession } = await import('./sessionService');
    const session = await createIdentitySession({ ...BASE_PARAMS, identityId: 'past-throttle-identity' }, 'mock');
    const record = identitySessionFixtures.find((s) => s.id === session.id)!;
    record.lastSeenAt = new Date(Date.now() - 6 * MINUTE_MS).toISOString();

    const before = Date.now();
    const touched = await touchSession(session.id, 'mock');
    expect(touched!.lastSeenAt).not.toBe(session.lastSeenAt);
    expect(Math.abs(new Date(touched!.expiresAt).getTime() - (before + 4 * HOUR_MS))).toBeLessThan(TOLERANCE_MS);
  });

  it('never extends expiresAt past createdAt + 16 hours, even when the idle window would otherwise allow it', async () => {
    const { createIdentitySession, touchSession } = await import('./sessionService');
    const session = await createIdentitySession({ ...BASE_PARAMS, identityId: 'near-absolute-cap-identity' }, 'mock');
    const record = identitySessionFixtures.find((s) => s.id === session.id)!;
    const createdAt = new Date(Date.now() - 15 * HOUR_MS - 50 * MINUTE_MS); // 15h50m old — 10 minutes from the 16h ceiling
    record.createdAt = createdAt.toISOString();
    record.lastSeenAt = new Date(Date.now() - 6 * MINUTE_MS).toISOString(); // past the touch throttle

    const touched = await touchSession(session.id, 'mock');
    const absoluteDeadline = createdAt.getTime() + 16 * HOUR_MS;
    const naiveIdleDeadline = Date.now() + 4 * HOUR_MS;
    expect(Math.abs(new Date(touched!.expiresAt).getTime() - absoluteDeadline)).toBeLessThan(TOLERANCE_MS);
    expect(new Date(touched!.expiresAt).getTime()).toBeLessThan(naiveIdleDeadline);
  });

  it('cannot revive a session already past its 16-hour absolute maximum by touching it', async () => {
    const { createIdentitySession, touchSession } = await import('./sessionService');
    const session = await createIdentitySession({ ...BASE_PARAMS, identityId: 'past-absolute-cap-identity' }, 'mock');
    const record = identitySessionFixtures.find((s) => s.id === session.id)!;
    const createdAt = new Date(Date.now() - 17 * HOUR_MS); // already past the 16h ceiling
    record.createdAt = createdAt.toISOString();
    record.lastSeenAt = new Date(Date.now() - 6 * MINUTE_MS).toISOString(); // past the touch throttle

    const touched = await touchSession(session.id, 'mock');
    const absoluteDeadline = createdAt.getTime() + 16 * HOUR_MS;
    expect(Math.abs(new Date(touched!.expiresAt).getTime() - absoluteDeadline)).toBeLessThan(TOLERANCE_MS);
    expect(new Date(touched!.expiresAt).getTime()).toBeLessThan(Date.now());
  });
});

describe('revokeSession / listActiveSessionsForIdentity', () => {
  it('a revoked session no longer appears in the active list', async () => {
    const { createIdentitySession, revokeSession, listActiveSessionsForIdentity } = await import('./sessionService');
    const session = await createIdentitySession({ ...BASE_PARAMS, identityId: 'revoke-test-identity' }, 'mock');
    expect(await listActiveSessionsForIdentity('revoke-test-identity', 'mock')).toHaveLength(1);

    await revokeSession(session.id, 'mock');
    expect(await listActiveSessionsForIdentity('revoke-test-identity', 'mock')).toHaveLength(0);
  });

  it('an expired session no longer appears in the active list even if not explicitly revoked', async () => {
    const { createIdentitySession, listActiveSessionsForIdentity } = await import('./sessionService');
    const session = await createIdentitySession({ ...BASE_PARAMS, identityId: 'expire-test-identity' }, 'mock');
    const record = identitySessionFixtures.find((s) => s.id === session.id)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();

    expect(await listActiveSessionsForIdentity('expire-test-identity', 'mock')).toHaveLength(0);
  });
});

describe('revokeAllSessionsForIdentity', () => {
  it('signs out everywhere when no exception is given', async () => {
    const { createIdentitySession, revokeAllSessionsForIdentity, listActiveSessionsForIdentity } = await import('./sessionService');
    await createIdentitySession({ ...BASE_PARAMS, identityId: 'everywhere-identity', deviceId: 'd1' }, 'mock');
    await createIdentitySession({ ...BASE_PARAMS, identityId: 'everywhere-identity', deviceId: 'd2' }, 'mock');

    const revokedCount = await revokeAllSessionsForIdentity('everywhere-identity', 'mock');
    expect(revokedCount).toBe(2);
    expect(await listActiveSessionsForIdentity('everywhere-identity', 'mock')).toHaveLength(0);
  });

  it('"sign out other devices" preserves the current session when excepted', async () => {
    const { createIdentitySession, revokeAllSessionsForIdentity, listActiveSessionsForIdentity } = await import('./sessionService');
    const current = await createIdentitySession({ ...BASE_PARAMS, identityId: 'except-identity', deviceId: 'current-device' }, 'mock');
    await createIdentitySession({ ...BASE_PARAMS, identityId: 'except-identity', deviceId: 'other-device' }, 'mock');

    const revokedCount = await revokeAllSessionsForIdentity('except-identity', 'mock', current.id);
    expect(revokedCount).toBe(1);
    const remaining = await listActiveSessionsForIdentity('except-identity', 'mock');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(current.id);
  });
});
