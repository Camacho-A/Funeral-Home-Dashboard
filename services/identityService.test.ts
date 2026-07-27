import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identityFixtures, MANORS_ADMIN_IDENTITY_ID, MANORS_ADMIN_DEMO_PASSWORD } from './__mocks__/identityFixtures';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `identity-test-${idCounter}`;
}

let lengthBefore: number;
beforeEach(() => {
  idCounter = 0;
  lengthBefore = identityFixtures.length;
});
afterEach(() => {
  identityFixtures.length = lengthBefore;
});

describe('findOrCreateIdentity', () => {
  it('creates a new pending identity for a new email', async () => {
    const { findOrCreateIdentity } = await import('./identityService');
    const { identity, isNew } = await findOrCreateIdentity({ email: 'new.person@example.com', displayName: 'New Person', idFactory }, 'mock');
    expect(isNew).toBe(true);
    expect(identity.status).toBe('pending');
    expect(identity.emailVerified).toBe(false);
    expect(identity.normalizedEmail).toBe('new.person@example.com');
  });

  it('is idempotent — a second call with the same (or differently-cased) email returns the same identity, never a duplicate', async () => {
    const { findOrCreateIdentity } = await import('./identityService');
    const first = await findOrCreateIdentity({ email: 'same.person@example.com', displayName: 'Same Person', idFactory }, 'mock');
    const second = await findOrCreateIdentity({ email: 'Same.Person@Example.com', displayName: 'Ignored', idFactory }, 'mock');
    expect(second.isNew).toBe(false);
    expect(second.identity.id).toBe(first.identity.id);
    expect(identityFixtures.filter((i) => i.normalizedEmail === 'same.person@example.com')).toHaveLength(1);
  });

  it('never duplicates an identity across what would be two different organizations\' invitations', async () => {
    const { findOrCreateIdentity } = await import('./identityService');
    const first = await findOrCreateIdentity({ email: 'multi.org@example.com', displayName: 'Multi Org', idFactory }, 'mock');
    const second = await findOrCreateIdentity({ email: 'multi.org@example.com', displayName: 'Multi Org', idFactory }, 'mock');
    expect(first.identity.id).toBe(second.identity.id);
  });
});

describe('findIdentityByEmail / getIdentityById', () => {
  it('finds the seeded Manor\'s administrator identity', async () => {
    const { findIdentityByEmail, getIdentityById } = await import('./identityService');
    const byEmail = await findIdentityByEmail('dana@managedcremations.test', 'mock');
    expect(byEmail?.id).toBe(MANORS_ADMIN_IDENTITY_ID);
    const byId = await getIdentityById(MANORS_ADMIN_IDENTITY_ID, 'mock');
    expect(byId?.status).toBe('active');
  });

  it('returns null for an unknown email or id', async () => {
    const { findIdentityByEmail, getIdentityById } = await import('./identityService');
    expect(await findIdentityByEmail('nobody@example.com', 'mock')).toBeNull();
    expect(await getIdentityById('no-such-id', 'mock')).toBeNull();
  });

  it('never exposes passwordHash or MFA secrets on the public Identity shape', async () => {
    const { getIdentityById } = await import('./identityService');
    const identity = await getIdentityById(MANORS_ADMIN_IDENTITY_ID, 'mock');
    expect(identity).not.toHaveProperty('passwordHash');
    expect(identity).not.toHaveProperty('mfaSecretReference');
    expect(identity).not.toHaveProperty('mfaRecoveryCodeHashes');
  });
});

describe('updateIdentity / recordSuccessfulLogin', () => {
  it('updates a profile field', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('./identityService');
    const { identity } = await findOrCreateIdentity({ email: 'update.me@example.com', displayName: 'Before', idFactory }, 'mock');
    const updated = await updateIdentity(identity.id, { displayName: 'After' }, 'mock');
    expect(updated?.displayName).toBe('After');
  });

  it('records lastLoginAt', async () => {
    const { findOrCreateIdentity, recordSuccessfulLogin, getIdentityById } = await import('./identityService');
    const { identity } = await findOrCreateIdentity({ email: 'login.me@example.com', displayName: 'Login Me', idFactory }, 'mock');
    expect(identity.lastLoginAt).toBeNull();
    await recordSuccessfulLogin(identity.id, 'mock');
    const after = await getIdentityById(identity.id, 'mock');
    expect(after?.lastLoginAt).not.toBeNull();
  });
});

describe('getIdentitySecrets / updateIdentitySecrets', () => {
  it('reads the demo password hash for the seeded Manor\'s administrator', async () => {
    const { getIdentitySecrets } = await import('./identityService');
    const secrets = await getIdentitySecrets(MANORS_ADMIN_IDENTITY_ID, 'mock');
    expect(secrets?.passwordHash).not.toBeNull();
    void MANORS_ADMIN_DEMO_PASSWORD;
  });

  it('updates secrets without disturbing the public Identity fields', async () => {
    const { findOrCreateIdentity, updateIdentitySecrets, getIdentityById } = await import('./identityService');
    const { identity } = await findOrCreateIdentity({ email: 'secrets.test@example.com', displayName: 'Secrets Test', idFactory }, 'mock');
    await updateIdentitySecrets(identity.id, { passwordHash: 'some-hash' }, 'mock');
    const stillSame = await getIdentityById(identity.id, 'mock');
    expect(stillSame?.displayName).toBe('Secrets Test');
  });
});
