import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityFixtures, emailVerificationTokenFixtures } from '@/services/__mocks__/identityFixtures';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `verify-email-route-test-${idCounter}`;
}

const { POST } = await import('./route');

function postRequest(body: unknown) {
  return POST(new Request('http://localhost/api/auth/verify-email', { method: 'POST', body: JSON.stringify(body) }));
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

describe('POST /api/auth/verify-email', () => {
  it('returns 400 when token is missing', async () => {
    expect((await postRequest({})).status).toBe(400);
  });

  it('returns 400 for a forged token', async () => {
    expect((await postRequest({ token: 'forged' })).status).toBe(400);
  });

  it('verifies email and activates a pending identity with a valid token', async () => {
    const { findOrCreateIdentity, getIdentityById } = await import('@/services/identityService');
    const { createVerificationToken } = await import('@/services/emailVerificationService');
    const { identity } = await findOrCreateIdentity({ email: 'verify.me@example.com', displayName: 'Verify Me', idFactory }, 'mock');
    const { token } = await createVerificationToken(identity.id, idFactory, 'mock');

    const response = await postRequest({ token });
    expect(response.status).toBe(200);

    const updated = await getIdentityById(identity.id, 'mock');
    expect(updated?.emailVerified).toBe(true);
    expect(updated?.status).toBe('active');
  });

  it('rejects an already-used token', async () => {
    const { findOrCreateIdentity } = await import('@/services/identityService');
    const { createVerificationToken } = await import('@/services/emailVerificationService');
    const { identity } = await findOrCreateIdentity({ email: 'reused.token@example.com', displayName: 'Reused', idFactory }, 'mock');
    const { token } = await createVerificationToken(identity.id, idFactory, 'mock');

    await postRequest({ token });
    const second = await postRequest({ token });
    expect(second.status).toBe(400);
  });
});
