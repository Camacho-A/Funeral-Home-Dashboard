import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '@/types/auth';

const state = vi.hoisted(() => ({ session: null as AuthSession | null, resolved: null as unknown }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/auth/session', () => ({ getSession: async () => state.session, clearSessionPath: (reason: string) => `/api/auth/clear-session?reason=${reason}` }));
vi.mock('@/lib/auth/resolveIdentitySession', () => ({ resolveIdentitySession: async () => state.resolved }));
vi.mock('@/app/login/actions', () => ({ logoutAction: async () => undefined }));

const { default: MfaSetupPage } = await import('./page');
const render = (next?: string) => MfaSetupPage({ searchParams: Promise.resolve({ next }) });
const identitySession = { user: { id: 'identity-fictional', email: 'f@fictional.test', displayName: 'F', source: 'identity' }, issuedAt: 0, expiresAt: 1, sessionId: 's' } as AuthSession;

beforeEach(() => {
  state.session = identitySession;
  state.resolved = { valid: true, identity: { mfaEnabled: false }, identitySession: {} };
});

describe('/mfa-setup', () => {
  it('needs a signed-in session', async () => {
    state.session = null;
    await expect(render('/cases')).rejects.toThrow('REDIRECT:/login');
  });

  it('a revoked or expired session is cleared, not offered enrollment', async () => {
    state.resolved = { valid: false, reason: 'revoked' };
    await expect(render()).rejects.toThrow('REDIRECT:/api/auth/clear-session?reason=revoked');
  });

  it('an already-enrolled identity goes straight on, to a same-site path only', async () => {
    state.resolved = { valid: true, identity: { mfaEnabled: true }, identitySession: {} };
    await expect(render('/cases')).rejects.toThrow('REDIRECT:/cases');
    await expect(render('https://elsewhere.example/phish')).rejects.toThrow('REDIRECT:/');
  });

  it('a not-yet-enrolled identity gets the setup step', async () => {
    expect(await render('/cases')).toBeTruthy();
  });
});
