import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures } from '@/services/__mocks__/portalFixtures';
import { capturedIdentityMessages } from '@/services/__mocks__/identityMessageSender';
import { resetRateLimiter } from '@/lib/rateLimiter';
import { hashPassword } from '@/lib/identity/passwordHashing';

vi.mock('@/lib/identity/messageSender', async () => {
  const { capturingIdentityMessageSender } = await import('@/services/__mocks__/identityMessageSender');
  return { getIdentityMessageSender: () => capturingIdentityMessageSender };
});

const { POST } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-forgot-password-route-test-${idCounter}`;
}

function forgotRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/family/forgot-password', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let lengths: { users: number; messages: number };
beforeEach(() => {
  idCounter = 0;
  resetRateLimiter();
  lengths = { users: portalUserFixtures.length, messages: capturedIdentityMessages.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  capturedIdentityMessages.length = lengths.messages;
});

describe('POST /api/family/forgot-password', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await forgotRequest({ email: 'x@example.com' }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid email shape', async () => {
    const response = await forgotRequest({ email: 'not-an-email' });
    expect(response.status).toBe(400);
  });

  it('returns the same generic ok response for an unknown email — never revealing existence', async () => {
    const response = await forgotRequest({ email: 'no-such-family@example.com' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(capturedIdentityMessages).toHaveLength(0);
  });

  it('sends a password_reset message (never the raw token in the response) for a real portal user', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    await findOrCreatePortalUser(
      { email: 'family-forgot@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );

    const response = await forgotRequest({ email: 'family-forgot@example.com' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    expect(capturedIdentityMessages).toHaveLength(1);
    expect(capturedIdentityMessages[0]).toMatchObject({ kind: 'password_reset', to: 'family-forgot@example.com' });
  });
});
