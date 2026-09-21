import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, passwordResetTokenFixtures } from '@/services/__mocks__/identityFixtures';
import { capturedIdentityMessages } from '@/services/__mocks__/identityMessageSender';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `forgot-password-action-test-${idCounter}`;
}

const redirectCalls: string[] = [];

// redirect() throws in real Next.js to abort rendering — mocked here to
// record the destination instead, matching the established pattern (see
// app/login/actions.test.ts's identical next/navigation mock) of
// substituting only the framework API a plain Vitest test has no context
// for, while letting forgotPasswordAction's own real logic run.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('@/lib/identity/messageSender', async () => {
  const { capturingIdentityMessageSender } = await import('@/services/__mocks__/identityMessageSender');
  return { getIdentityMessageSender: () => capturingIdentityMessageSender };
});

const { forgotPasswordAction } = await import('./actions');

function formData(email: string) {
  const data = new FormData();
  data.set('email', email);
  return data;
}

let lengths: { identity: number; tokens: number; messages: number };
beforeEach(() => {
  idCounter = 0;
  redirectCalls.length = 0;
  process.env.DATA_ADAPTER = 'mock';
  lengths = { identity: identityFixtures.length, tokens: passwordResetTokenFixtures.length, messages: capturedIdentityMessages.length };
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  identityFixtures.length = lengths.identity;
  passwordResetTokenFixtures.length = lengths.tokens;
  capturedIdentityMessages.length = lengths.messages;
});

async function seedIdentityWithStatus(email: string, status: 'pending' | 'active' | 'locked' | 'disabled' | 'deleted') {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { identity } = await findOrCreateIdentity({ email, displayName: 'Action Status Test', idFactory }, 'mock');
  await updateIdentity(identity.id, { status }, 'mock');
  return identity;
}

describe('forgotPasswordAction — the Server Action the real /forgot-password page actually submits to', () => {
  it('always redirects to /forgot-password?sent=1, regardless of outcome', async () => {
    await expect(forgotPasswordAction(formData('nobody@example.com'))).rejects.toThrow(/REDIRECT:/);
    expect(redirectCalls).toEqual(['/forgot-password?sent=1']);
  });

  it('active identity → a reset token is created and a message is sent (never the token itself, only via the message sender)', async () => {
    const identity = await seedIdentityWithStatus('action-active@example.com', 'active');
    await expect(forgotPasswordAction(formData('action-active@example.com'))).rejects.toThrow(/REDIRECT:/);

    expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(true);
    const sent = capturedIdentityMessages.find((m) => m.kind === 'password_reset' && m.to === 'action-active@example.com');
    expect(sent).toBeDefined();
    expect(typeof (sent as { token: string }).token).toBe('string');
  });

  it('pending identity → no token, no message (Manors go-live security correction)', async () => {
    const identity = await seedIdentityWithStatus('action-pending@example.com', 'pending');
    await expect(forgotPasswordAction(formData('action-pending@example.com'))).rejects.toThrow(/REDIRECT:/);

    expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(false);
    expect(capturedIdentityMessages.some((m) => m.to === 'action-pending@example.com')).toBe(false);
  });

  it('locked identity → no token, no message (Manors go-live security correction)', async () => {
    const identity = await seedIdentityWithStatus('action-locked@example.com', 'locked');
    await expect(forgotPasswordAction(formData('action-locked@example.com'))).rejects.toThrow(/REDIRECT:/);

    expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(false);
    expect(capturedIdentityMessages.some((m) => m.to === 'action-locked@example.com')).toBe(false);
  });

  it('disabled identity → no token, no message', async () => {
    const identity = await seedIdentityWithStatus('action-disabled@example.com', 'disabled');
    await expect(forgotPasswordAction(formData('action-disabled@example.com'))).rejects.toThrow(/REDIRECT:/);

    expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(false);
    expect(capturedIdentityMessages.some((m) => m.to === 'action-disabled@example.com')).toBe(false);
  });

  it('deleted identity → no token, no message', async () => {
    const identity = await seedIdentityWithStatus('action-deleted@example.com', 'deleted');
    await expect(forgotPasswordAction(formData('action-deleted@example.com'))).rejects.toThrow(/REDIRECT:/);

    expect(passwordResetTokenFixtures.some((t) => t.identityId === identity.id)).toBe(false);
    expect(capturedIdentityMessages.some((m) => m.to === 'action-deleted@example.com')).toBe(false);
  });

  it('nonexistent email → no token, no message, same redirect as every other case', async () => {
    await expect(forgotPasswordAction(formData('truly-nobody@example.com'))).rejects.toThrow(/REDIRECT:/);
    expect(redirectCalls).toEqual(['/forgot-password?sent=1']);
    expect(capturedIdentityMessages.some((m) => m.to === 'truly-nobody@example.com')).toBe(false);
  });
});
