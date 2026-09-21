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

  /** Security correction (2026-09, Manors go-live): only an `active`
      identity may receive/redeem a password reset. `pending` (invited but
      never activated — no password to reset in the first place) and
      `locked` (an active brute-force lockout) previously slipped through
      an exclude-list (`!== 'disabled' && !== 'deleted'`) and got a fully
      working reset link — this is the regression coverage for that fix. */
  describe('active-only eligibility (Manors go-live security correction)', () => {
    async function seedIdentityWithStatus(email: string, status: 'pending' | 'active' | 'locked' | 'disabled' | 'deleted') {
      const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
      const { identity } = await findOrCreateIdentity({ email, displayName: 'Status Test', idFactory }, 'mock');
      await updateIdentity(identity.id, { status }, 'mock');
      return identity;
    }

    it('active → a reset is issued and a message is sent', async () => {
      const identity = await seedIdentityWithStatus('active-eligible@example.com', 'active');
      const response = await postRequest({ email: 'active-eligible@example.com' });
      expect(response.status).toBe(200);
      expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(true);
      const sent = capturedIdentityMessages.find((m) => m.kind === 'password_reset' && m.to === 'active-eligible@example.com');
      expect(sent).toBeDefined();
    });

    it('pending → generic response, no token, no message', async () => {
      const identity = await seedIdentityWithStatus('pending-ineligible@example.com', 'pending');
      const response = await postRequest({ email: 'pending-ineligible@example.com' });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(false);
      expect(capturedIdentityMessages.some((m) => m.to === 'pending-ineligible@example.com')).toBe(false);
    });

    it('locked → generic response, no token, no message', async () => {
      const identity = await seedIdentityWithStatus('locked-ineligible@example.com', 'locked');
      const response = await postRequest({ email: 'locked-ineligible@example.com' });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(false);
      expect(capturedIdentityMessages.some((m) => m.to === 'locked-ineligible@example.com')).toBe(false);
    });

    it('disabled → generic response, no token, no message', async () => {
      const identity = await seedIdentityWithStatus('disabled-ineligible@example.com', 'disabled');
      const response = await postRequest({ email: 'disabled-ineligible@example.com' });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(false);
      expect(capturedIdentityMessages.some((m) => m.to === 'disabled-ineligible@example.com')).toBe(false);
    });

    it('deleted → generic response, no token, no message', async () => {
      const identity = await seedIdentityWithStatus('deleted-ineligible@example.com', 'deleted');
      const response = await postRequest({ email: 'deleted-ineligible@example.com' });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(false);
      expect(capturedIdentityMessages.some((m) => m.to === 'deleted-ineligible@example.com')).toBe(false);
    });

    it('returns byte-identical response bodies across active, pending, locked, disabled, deleted, and nonexistent emails — never distinguishable', async () => {
      await seedIdentityWithStatus('identical-active@example.com', 'active');
      await seedIdentityWithStatus('identical-pending@example.com', 'pending');
      await seedIdentityWithStatus('identical-locked@example.com', 'locked');
      await seedIdentityWithStatus('identical-disabled@example.com', 'disabled');
      await seedIdentityWithStatus('identical-deleted@example.com', 'deleted');

      const emails = [
        'identical-active@example.com',
        'identical-pending@example.com',
        'identical-locked@example.com',
        'identical-disabled@example.com',
        'identical-deleted@example.com',
        'identical-nonexistent@example.com',
      ];
      const bodies = await Promise.all(emails.map(async (email) => {
        const response = await postRequest({ email });
        return { status: response.status, body: await response.json() };
      }));

      const [first, ...rest] = bodies;
      for (const b of rest) {
        expect(b.status).toBe(first.status);
        expect(b.body).toEqual(first.body);
      }
    });
  });
});
