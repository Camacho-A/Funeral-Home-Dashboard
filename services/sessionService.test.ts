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
  rememberDevice: false,
  passwordVersionAtIssue: 1,
  idFactory,
};

describe('createIdentitySession', () => {
  it('creates a session with no organization selected yet', async () => {
    const { createIdentitySession } = await import('./sessionService');
    const session = await createIdentitySession(BASE_PARAMS, 'mock');
    expect(session.organizationId).toBeNull();
    expect(session.revokedAt).toBeNull();
  });

  it('a remembered device gets a much longer expiry than an unremembered one', async () => {
    const { createIdentitySession } = await import('./sessionService');
    const short = await createIdentitySession({ ...BASE_PARAMS, rememberDevice: false }, 'mock');
    const long = await createIdentitySession({ ...BASE_PARAMS, rememberDevice: true }, 'mock');
    expect(new Date(long.expiresAt).getTime()).toBeGreaterThan(new Date(short.expiresAt).getTime());
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
