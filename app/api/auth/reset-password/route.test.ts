import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityFixtures, passwordResetTokenFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `reset-password-route-test-${idCounter}`;
}

const { POST } = await import('./route');

function postRequest(body: unknown) {
  return POST(new Request('http://localhost/api/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }));
}

let lengths: { identity: number; tokens: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { identity: identityFixtures.length, tokens: passwordResetTokenFixtures.length, sessions: identitySessionFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  passwordResetTokenFixtures.length = lengths.tokens;
  identitySessionFixtures.length = lengths.sessions;
});

describe('POST /api/auth/reset-password', () => {
  it('returns 400 for a missing/short newPassword', async () => {
    expect((await postRequest({ token: 'whatever', newPassword: 'short' })).status).toBe(400);
  });

  it('returns 400 for an invalid/forged token', async () => {
    const response = await postRequest({ token: 'forged-token', newPassword: 'BrandNewPass1!' });
    expect(response.status).toBe(400);
  });

  it('resets the password with a valid token and revokes every existing session for that identity', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { setPassword, createPasswordResetToken, verifyPassword } = await import('@/services/passwordService');
    const { createIdentitySession, listActiveSessionsForIdentity } = await import('@/services/sessionService');

    const { identity } = await findOrCreateIdentity({ email: 'resetme@example.com', displayName: 'Reset Me', idFactory }, 'mock');
    await updateIdentity(identity.id, { status: 'active' }, 'mock');
    await setPassword(identity.id, 'OldPassword1!', 'mock');
    await createIdentitySession({ identityId: identity.id, deviceId: 'device-1', rememberDevice: false, passwordVersionAtIssue: 1, idFactory }, 'mock');
    expect(await listActiveSessionsForIdentity(identity.id, 'mock')).toHaveLength(1);

    const { token } = await createPasswordResetToken(identity.id, idFactory, 'mock');
    const response = await postRequest({ token, newPassword: 'BrandNewPass1!' });
    expect(response.status).toBe(200);

    expect(await verifyPassword(identity.id, 'BrandNewPass1!', 'mock')).toBe(true);
    expect(await listActiveSessionsForIdentity(identity.id, 'mock')).toHaveLength(0);
  });

  it('rejects an already-used token (single-use)', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { createPasswordResetToken } = await import('@/services/passwordService');
    const { identity } = await findOrCreateIdentity({ email: 'usedtoken@example.com', displayName: 'Used Token', idFactory }, 'mock');
    await updateIdentity(identity.id, { status: 'active' }, 'mock');
    const { token } = await createPasswordResetToken(identity.id, idFactory, 'mock');

    await postRequest({ token, newPassword: 'FirstPass1!' });
    const second = await postRequest({ token, newPassword: 'SecondPass1!' });
    expect(second.status).toBe(400);
  });
});
