import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identityFixtures, emailVerificationTokenFixtures } from './__mocks__/identityFixtures';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `verify-test-${idCounter}`;
}

let lengths: { identity: number; tokens: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { identity: identityFixtures.length, tokens: emailVerificationTokenFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  emailVerificationTokenFixtures.length = lengths.tokens;
});

async function seedPendingIdentity(email: string) {
  const { findOrCreateIdentity } = await import('./identityService');
  return (await findOrCreateIdentity({ email, displayName: 'Test User', idFactory }, 'mock')).identity;
}

describe('verifyEmailWithToken', () => {
  it('activates a pending identity and marks emailVerified once verified', async () => {
    const { createVerificationToken, verifyEmailWithToken } = await import('./emailVerificationService');
    const { getIdentityById } = await import('./identityService');
    const identity = await seedPendingIdentity('verify.me@example.com');
    expect(identity.status).toBe('pending');

    const { token } = await createVerificationToken(identity.id, idFactory, 'mock');
    const result = await verifyEmailWithToken(token, 'mock');
    expect(result.success).toBe(true);

    const after = await getIdentityById(identity.id, 'mock');
    expect(after?.emailVerified).toBe(true);
    expect(after?.status).toBe('active');
  });

  it('is single-use', async () => {
    const { createVerificationToken, verifyEmailWithToken } = await import('./emailVerificationService');
    const identity = await seedPendingIdentity('singleuse.verify@example.com');
    const { token } = await createVerificationToken(identity.id, idFactory, 'mock');

    expect((await verifyEmailWithToken(token, 'mock')).success).toBe(true);
    const second = await verifyEmailWithToken(token, 'mock');
    expect(second.success).toBe(false);
    if (!second.success) expect(second.reason).toBe('already_used');
  });

  it('rejects an expired token', async () => {
    const { createVerificationToken, verifyEmailWithToken } = await import('./emailVerificationService');
    const identity = await seedPendingIdentity('expired.verify@example.com');
    const { token } = await createVerificationToken(identity.id, idFactory, 'mock');

    const record = emailVerificationTokenFixtures.find((t) => t.identityId === identity.id)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();

    const result = await verifyEmailWithToken(token, 'mock');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('expired_token');
  });

  it('rejects an invalid/forged token', async () => {
    const { verifyEmailWithToken } = await import('./emailVerificationService');
    const result = await verifyEmailWithToken('forged', 'mock');
    expect(result.success).toBe(false);
  });
});

describe('resendVerification', () => {
  it('issues a fresh token that itself verifies successfully', async () => {
    const { createVerificationToken, resendVerification, verifyEmailWithToken } = await import('./emailVerificationService');
    const identity = await seedPendingIdentity('resend@example.com');
    await createVerificationToken(identity.id, idFactory, 'mock'); // an initial, now-superseded token

    const { token: freshToken } = await resendVerification(identity.id, idFactory, 'mock');
    const result = await verifyEmailWithToken(freshToken, 'mock');
    expect(result.success).toBe(true);
  });

  it('an old, expired token remains rejected even after a fresh one is issued', async () => {
    const { createVerificationToken, resendVerification, verifyEmailWithToken } = await import('./emailVerificationService');
    const identity = await seedPendingIdentity('oldexpired@example.com');
    const { token: oldToken } = await createVerificationToken(identity.id, idFactory, 'mock');
    const oldRecord = emailVerificationTokenFixtures.find((t) => t.identityId === identity.id)!;
    oldRecord.expiresAt = new Date(Date.now() - 1000).toISOString();

    await resendVerification(identity.id, idFactory, 'mock');

    const result = await verifyEmailWithToken(oldToken, 'mock');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('expired_token');
  });
});

describe('Phase 23: listTokensForIdentity / invalidateTokensForIdentity', () => {
  it('lists every token ever issued for an identity, including superseded ones', async () => {
    const { createVerificationToken, resendVerification, listTokensForIdentity } = await import('./emailVerificationService');
    const identity = await seedPendingIdentity('list-tokens@example.com');
    await createVerificationToken(identity.id, idFactory, 'mock');
    await resendVerification(identity.id, idFactory, 'mock');

    const tokens = await listTokensForIdentity(identity.id, 'mock');
    expect(tokens).toHaveLength(2);
    expect(tokens.every((t) => t.identityId === identity.id)).toBe(true);
  });

  it('invalidates every live token so none of them can later verify', async () => {
    const { createVerificationToken, resendVerification, invalidateTokensForIdentity, verifyEmailWithToken } = await import('./emailVerificationService');
    const identity = await seedPendingIdentity('invalidate-tokens@example.com');
    const { token: firstToken } = await createVerificationToken(identity.id, idFactory, 'mock');
    const { token: secondToken } = await resendVerification(identity.id, idFactory, 'mock');

    await invalidateTokensForIdentity(identity.id, 'mock');

    const firstResult = await verifyEmailWithToken(firstToken, 'mock');
    const secondResult = await verifyEmailWithToken(secondToken, 'mock');
    expect(firstResult.success).toBe(false);
    expect(secondResult.success).toBe(false);
    if (!firstResult.success) expect(firstResult.reason).toBe('already_used');
    if (!secondResult.success) expect(secondResult.reason).toBe('already_used');
  });

  it('is idempotent — invalidating an already-used or already-invalidated token is a no-op, not an error', async () => {
    const { createVerificationToken, invalidateTokensForIdentity, verifyEmailWithToken } = await import('./emailVerificationService');
    const identity = await seedPendingIdentity('invalidate-idempotent@example.com');
    const { token } = await createVerificationToken(identity.id, idFactory, 'mock');
    await verifyEmailWithToken(token, 'mock'); // already used via the normal verification path

    await expect(invalidateTokensForIdentity(identity.id, 'mock')).resolves.toBeUndefined();
    await expect(invalidateTokensForIdentity(identity.id, 'mock')).resolves.toBeUndefined();
  });
});
