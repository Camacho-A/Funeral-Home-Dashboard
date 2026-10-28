import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Outlook mailbox sign-in return (2026-10): every failure is logged as one
 * safe `[crematory-mailbox]` line and shown to the administrator by step.
 * Fictional values; Microsoft and the connect service are simulated.
 */
const cookieJar = vi.hoisted(() => ({ value: 'signed-state-cookie' as string | undefined }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (cookieJar.value ? { value: cookieJar.value } : undefined) }) }));
const state = vi.hoisted(() => ({ payload: { organizationId: 'managed-cremations', staffProfileId: 'identity-admin' } as Record<string, string> | null }));
vi.mock('@/lib/auth/calendarOAuthState', () => ({ verifyOAuthStateCookie: () => state.payload }));
const auth = vi.hoisted(() => ({ context: { organizationId: 'managed-cremations', userId: 'identity-admin' } as Record<string, string> | null }));
vi.mock('@/lib/crematory/routeAuth', () => ({ authorizeCrematory: async () => ({ context: auth.context, mode: 'wix' }) }));
const complete = vi.hoisted(() => vi.fn());
vi.mock('@/services/crematory/crematoryMailboxService', async () => {
  const actual = await vi.importActual<typeof import('@/services/crematory/crematoryMailboxService')>('@/services/crematory/crematoryMailboxService');
  return { ...actual, completeMailboxAuthorization: complete };
});

const { GET } = await import('./route');
const { MailboxConnectError } = await import('@/services/crematory/crematoryMailboxService');

const CODE = 'fictional-authorization-code-CCCC';
const call = (query: string) => GET(new Request(`https://solis.example/api/organization/crematory-settings/mailbox/callback?${query}`));
const shownError = (response: Response) => new URL(response.headers.get('location')!).searchParams.get('mailboxError');

let logged: string[];
beforeEach(() => {
  cookieJar.value = 'signed-state-cookie';
  state.payload = { organizationId: 'managed-cremations', staffProfileId: 'identity-admin' };
  auth.context = { organizationId: 'managed-cremations', userId: 'identity-admin' };
  complete.mockReset();
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
});
afterEach(() => vi.restoreAllMocks());

const lastLog = () => JSON.parse(logged.at(-1)!.replace('[crematory-mailbox] ', ''));

describe('Outlook mailbox sign-in return', () => {
  it('success: back to Settings → Crematory, nothing logged', async () => {
    complete.mockResolvedValue({ accountEmail: 'office@funeralhome.example' });
    const response = await call(`code=${CODE}&state=s1`);
    expect(new URL(response.headers.get('location')!).searchParams.get('mailboxConnected')).toBe('office@funeralhome.example');
    expect(logged).toEqual([]);
  });

  it('Microsoft refused the sign-in: its OAuth code and AADSTS number only, with the fix for AADSTS50194', async () => {
    const description = 'AADSTS50194: Application is not configured as a multi-tenant application. Trace ID: 1234 Correlation ID: 5678';
    const response = await call(`error=invalid_request&error_description=${encodeURIComponent(description)}`);
    expect(shownError(response)).toBe('Microsoft did not sign in the mailbox (AADSTS50194). The app registration must allow accounts in any organizational directory (multitenant).');
    expect(lastLog()).toEqual({ operation: 'mailbox_callback', stage: 'microsoft_authorization', category: 'invalid_request:AADSTS50194', httpStatus: null });
    expect(logged.join(' ')).not.toContain('Trace ID');
  });

  it('expired or mismatched sign-in, and a different SOLIS user, are each logged', async () => {
    cookieJar.value = undefined;
    state.payload = null;
    expect(shownError(await call(`code=${CODE}&state=s1`))).toBe('The Microsoft sign-in expired. Please try again.');
    expect(lastLog()).toMatchObject({ stage: 'sign_in_state', category: 'no_state_cookie' });

    cookieJar.value = 'signed-state-cookie';
    state.payload = { organizationId: 'managed-cremations', staffProfileId: 'identity-admin' };
    auth.context = { organizationId: 'managed-cremations', userId: 'someone-else' };
    expect(shownError(await call(`code=${CODE}&state=s1`))).toBe('Sign in to SOLIS as an administrator and try again.');
    expect(lastLog()).toMatchObject({ stage: 'administrator_check', category: 'different_user' });
  });

  it('a failed step is shown by name and logged — e.g. Wix refusing the save', async () => {
    complete.mockRejectedValue(
      new MailboxConnectError('Microsoft sign-in worked, but SOLIS could not save the mailbox to the organization settings (Wix HTTP 400). Nothing was connected.', 500, {
        operation: 'mailbox_connect',
        stage: 'save_settings',
        category: 'wix_rejected',
        httpStatus: 400,
      }),
    );
    const response = await call(`code=${CODE}&state=s1`);
    expect(shownError(response)).toContain('(Wix HTTP 400)');
    expect(lastLog()).toEqual({ operation: 'mailbox_connect', stage: 'save_settings', category: 'wix_rejected', httpStatus: 400 });
  });

  it('an unexpected error: logged by type only; the message says it was logged', async () => {
    complete.mockRejectedValue(new TypeError(`boom ${CODE}`));
    const response = await call(`code=${CODE}&state=s1`);
    expect(shownError(response)).toBe('The mailbox could not be connected (unexpected error — logged for SOLIS support).');
    expect(lastLog()).toEqual({ operation: 'mailbox_connect', stage: 'unknown', category: 'TypeError', httpStatus: null });
    expect(logged.join(' ')).not.toContain(CODE);
  });
});
