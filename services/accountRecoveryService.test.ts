import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identityFixtures, loginActivityEventFixtures } from './__mocks__/identityFixtures';
import { MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT } from '../domain/identity/lockoutPolicy';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `recovery-test-${idCounter}`;
}

let lengths: { identity: number; events: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { identity: identityFixtures.length, events: loginActivityEventFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  loginActivityEventFixtures.length = lengths.events;
});

async function seedIdentity(email: string) {
  const { findOrCreateIdentity } = await import('./identityService');
  return (await findOrCreateIdentity({ email, displayName: 'Recovery Test', idFactory }, 'mock')).identity;
}

describe('recordLoginActivity', () => {
  it('records an event with a null identityId for an unknown email (email enumeration protection)', async () => {
    const { recordLoginActivity } = await import('./accountRecoveryService');
    const event = await recordLoginActivity({ identityId: null, eventType: 'login_failed', idFactory }, 'mock');
    expect(event.identityId).toBeNull();
    expect(event.eventType).toBe('login_failed');
  });

  it('records a successful login event', async () => {
    const { recordLoginActivity } = await import('./accountRecoveryService');
    const identity = await seedIdentity('activity@example.com');
    const event = await recordLoginActivity({ identityId: identity.id, organizationId: 'org-1', eventType: 'login_succeeded', idFactory }, 'mock');
    expect(event.identityId).toBe(identity.id);
  });
});

describe('countRecentFailedAttempts / checkAndApplyLockout', () => {
  it('counts only login_failed events for the given identity', async () => {
    const { recordLoginActivity, countRecentFailedAttempts } = await import('./accountRecoveryService');
    const identity = await seedIdentity('countme@example.com');
    await recordLoginActivity({ identityId: identity.id, eventType: 'login_failed', idFactory }, 'mock');
    await recordLoginActivity({ identityId: identity.id, eventType: 'login_failed', idFactory }, 'mock');
    await recordLoginActivity({ identityId: identity.id, eventType: 'login_succeeded', idFactory }, 'mock');

    expect(await countRecentFailedAttempts(identity.id, 'mock')).toBe(2);
  });

  it('does not lock the account below the failure threshold', async () => {
    const { recordLoginActivity, checkAndApplyLockout } = await import('./accountRecoveryService');
    const { getIdentityById } = await import('./identityService');
    const identity = await seedIdentity('belowthreshold@example.com');
    for (let i = 0; i < MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT - 1; i += 1) {
      await recordLoginActivity({ identityId: identity.id, eventType: 'login_failed', idFactory }, 'mock');
    }
    const result = await checkAndApplyLockout(identity.id, 'mock');
    expect(result.locked).toBe(false);
    expect((await getIdentityById(identity.id, 'mock'))?.status).not.toBe('locked');
  });

  it('locks the account once the failure threshold is reached', async () => {
    const { recordLoginActivity, checkAndApplyLockout } = await import('./accountRecoveryService');
    const { getIdentityById } = await import('./identityService');
    const identity = await seedIdentity('lockme@example.com');
    for (let i = 0; i < MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT; i += 1) {
      await recordLoginActivity({ identityId: identity.id, eventType: 'login_failed', idFactory }, 'mock');
    }
    const result = await checkAndApplyLockout(identity.id, 'mock');
    expect(result.locked).toBe(true);
    expect((await getIdentityById(identity.id, 'mock'))?.status).toBe('locked');
  });

  it('ignores failed attempts outside the lockout window', async () => {
    const { recordLoginActivity, countRecentFailedAttempts } = await import('./accountRecoveryService');
    const identity = await seedIdentity('outsidewindow@example.com');
    const event = await recordLoginActivity({ identityId: identity.id, eventType: 'login_failed', idFactory }, 'mock');
    const record = loginActivityEventFixtures.find((e) => e.id === event.id)!;
    record.timestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago, outside the 15-minute window

    expect(await countRecentFailedAttempts(identity.id, 'mock')).toBe(0);
  });
});

describe('unlockIfExpired', () => {
  it('does not unlock before the lockout duration has passed', async () => {
    const { unlockIfExpired } = await import('./accountRecoveryService');
    const { updateIdentity } = await import('./identityService');
    const identity = await seedIdentity('stilllocked@example.com');
    await updateIdentity(identity.id, { status: 'locked' }, 'mock');

    expect(await unlockIfExpired(identity.id, 'mock')).toBe(false);
  });

  it('unlocks once the lockout duration has passed', async () => {
    const { unlockIfExpired } = await import('./accountRecoveryService');
    const { updateIdentity, getIdentityById } = await import('./identityService');
    const identity = await seedIdentity('expiredlock@example.com');
    await updateIdentity(identity.id, { status: 'locked' }, 'mock');

    const index = identityFixtures.findIndex((i) => i.id === identity.id);
    identityFixtures[index] = { ...identityFixtures[index], updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() };

    expect(await unlockIfExpired(identity.id, 'mock')).toBe(true);
    expect((await getIdentityById(identity.id, 'mock'))?.status).toBe('active');
  });

  it('is a no-op for an identity that is not locked', async () => {
    const { unlockIfExpired } = await import('./accountRecoveryService');
    const identity = await seedIdentity('neverlocked@example.com');
    expect(await unlockIfExpired(identity.id, 'mock')).toBe(false);
  });
});
