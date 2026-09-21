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

  /** Security correction (2026-09, Manors go-live): the same active-only
      policy as the staff side — `isPortalUserEligibleForPasswordReset`. */
  it('disabled portal user → generic response, no message sent', async () => {
    const { findOrCreatePortalUser, updatePortalUser } = await import('@/services/portal/portalUserService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-disabled@example.com', displayName: 'Disabled Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    await updatePortalUser(portalUser.id, { status: 'disabled' }, 'mock');

    const response = await forgotRequest({ email: 'family-disabled@example.com' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(capturedIdentityMessages.some((m) => m.to === 'family-disabled@example.com')).toBe(false);
  });

  it('returns identical responses for an active user, a disabled user, and a nonexistent email', async () => {
    const { findOrCreatePortalUser, updatePortalUser } = await import('@/services/portal/portalUserService');
    await findOrCreatePortalUser(
      { email: 'family-identical-active@example.com', displayName: 'Active Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const { portalUser: disabledUser } = await findOrCreatePortalUser(
      { email: 'family-identical-disabled@example.com', displayName: 'Disabled Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    await updatePortalUser(disabledUser.id, { status: 'disabled' }, 'mock');

    const emails = ['family-identical-active@example.com', 'family-identical-disabled@example.com', 'family-identical-nonexistent@example.com'];
    const results = await Promise.all(emails.map(async (email) => {
      const response = await forgotRequest({ email });
      return { status: response.status, body: await response.json() };
    }));

    const [first, ...rest] = results;
    for (const r of rest) {
      expect(r.status).toBe(first.status);
      expect(r.body).toEqual(first.body);
    }
  });
});
