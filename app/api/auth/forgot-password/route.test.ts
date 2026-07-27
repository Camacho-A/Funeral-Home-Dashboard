import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, passwordResetTokenFixtures } from '@/services/__mocks__/identityFixtures';
import { capturedIdentityMessages } from '@/services/__mocks__/identityMessageSender';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `forgot-password-route-test-${idCounter}`;
}

vi.mock('@/lib/identity/messageSender', async () => {
  const { capturingIdentityMessageSender } = await import('@/services/__mocks__/identityMessageSender');
  return { getIdentityMessageSender: () => capturingIdentityMessageSender };
});

const { POST } = await import('./route');

function postRequest(body: unknown) {
  return POST(
    new Request('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify(body),
    }),
  );
}

let lengths: { identity: number; tokens: number; messages: number };
beforeEach(() => {
  idCounter = 0;
  process.env.DATA_ADAPTER = 'mock';
  lengths = { identity: identityFixtures.length, tokens: passwordResetTokenFixtures.length, messages: capturedIdentityMessages.length };
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  identityFixtures.length = lengths.identity;
  passwordResetTokenFixtures.length = lengths.tokens;
  capturedIdentityMessages.length = lengths.messages;
});

describe('POST /api/auth/forgot-password', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await POST(
      new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'https://evil.example.com', host: 'localhost' },
        body: JSON.stringify({ email: 'forgot.me@example.com' }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it('returns 400 when email is missing', async () => {
    expect((await postRequest({})).status).toBe(400);
  });

  it('sends a password-reset message (never the token itself) for a real, active identity', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { identity } = await findOrCreateIdentity({ email: 'forgot.me@example.com', displayName: 'Forgot Me', idFactory }, 'mock');
    await updateIdentity(identity.id, { status: 'active' }, 'mock');

    const response = await postRequest({ email: 'forgot.me@example.com' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.resetToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/token/i);

    expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(true);
    const sent = capturedIdentityMessages.find((m) => m.kind === 'password_reset' && m.to === 'forgot.me@example.com');
    expect(sent).toBeDefined();
    expect(typeof (sent as { token: string }).token).toBe('string');
  });

  it('returns the identical generic response for an unknown email — no enumeration signal, and sends nothing', async () => {
    const known = await postRequest({ email: 'nobody-at-all@example.com' });
    const knownBody = await known.json();
    expect(known.status).toBe(200);
    expect(knownBody.resetToken).toBeUndefined();
    expect(knownBody.ok).toBe(true);
    expect(capturedIdentityMessages.some((m) => m.to === 'nobody-at-all@example.com')).toBe(false);
  });
});
