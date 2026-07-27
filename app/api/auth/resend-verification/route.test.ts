import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, emailVerificationTokenFixtures } from '@/services/__mocks__/identityFixtures';
import { capturedIdentityMessages } from '@/services/__mocks__/identityMessageSender';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `resend-verification-route-test-${idCounter}`;
}

vi.mock('@/lib/identity/messageSender', async () => {
  const { capturingIdentityMessageSender } = await import('@/services/__mocks__/identityMessageSender');
  return { getIdentityMessageSender: () => capturingIdentityMessageSender };
});

const { POST } = await import('./route');

function postRequest(body: unknown) {
  return POST(
    new Request('http://localhost/api/auth/resend-verification', {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify(body),
    }),
  );
}

let lengths: { identity: number; tokens: number; messages: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { identity: identityFixtures.length, tokens: emailVerificationTokenFixtures.length, messages: capturedIdentityMessages.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  emailVerificationTokenFixtures.length = lengths.tokens;
  capturedIdentityMessages.length = lengths.messages;
});

describe('POST /api/auth/resend-verification', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await POST(
      new Request('http://localhost/api/auth/resend-verification', {
        method: 'POST',
        headers: { origin: 'https://evil.example.com', host: 'localhost' },
        body: JSON.stringify({ email: 'resend.me@example.com' }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it('returns 400 when email is missing', async () => {
    expect((await postRequest({})).status).toBe(400);
  });

  it('sends a verification message (never the token itself) for a real, not-yet-verified identity', async () => {
    const { findOrCreateIdentity } = await import('@/services/identityService');
    const { identity } = await findOrCreateIdentity({ email: 'resend.me@example.com', displayName: 'Resend Me', idFactory }, 'mock');

    const response = await postRequest({ email: 'resend.me@example.com' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verificationToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/token/i);

    expect(emailVerificationTokenFixtures.some((t) => t.identityId === identity.id)).toBe(true);
    const sent = capturedIdentityMessages.find((m) => m.kind === 'email_verification' && m.to === 'resend.me@example.com');
    expect(sent).toBeDefined();
    expect(typeof (sent as { token: string }).token).toBe('string');
  });

  it('returns the identical generic response for an already-verified identity — no signal leaked, nothing sent', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { identity } = await findOrCreateIdentity({ email: 'already.verified@example.com', displayName: 'Already Verified', idFactory }, 'mock');
    await updateIdentity(identity.id, { emailVerified: true }, 'mock');

    const response = await postRequest({ email: 'already.verified@example.com' });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.verificationToken).toBeUndefined();
    expect(capturedIdentityMessages.some((m) => m.to === 'already.verified@example.com')).toBe(false);
  });

  it('returns the identical generic response for an unknown email', async () => {
    const response = await postRequest({ email: 'never-signed-up@example.com' });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.verificationToken).toBeUndefined();
    expect(capturedIdentityMessages.some((m) => m.to === 'never-signed-up@example.com')).toBe(false);
  });
});
