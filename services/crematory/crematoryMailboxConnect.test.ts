import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Outlook mailbox connection diagnostics (2026-10). The real connect flow
 * with Microsoft simulated (fetch stubbed) and Wix Data stubbed. Fictional
 * values only; asserts that no token, code or secret ever reaches a log
 * line or a message.
 */
const wix = vi.hoisted(() => ({
  query: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/lib/wixDataApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wixDataApi')>('@/lib/wixDataApi');
  return { ...actual, queryWixDataItems: wix.query, updateWixDataItem: wix.update };
});

const { beginMailboxAuthorization, completeMailboxAuthorization, MailboxConnectError, resetMockCrematoryMailboxes, getCrematoryMailboxStatus, aadstsCode, safeOAuthErrorCode } =
  await import('./crematoryMailboxService');
const { WixDataApiError } = await import('@/lib/wixDataApi');

const ORG = 'managed-cremations';
const SECRET = 'fictional-client-secret-value';
const ACCESS = 'fictional-access-token-AAAA';
const REFRESH = 'fictional-refresh-token-RRRR';
const CODE = 'fictional-authorization-code-CCCC';

function begin() {
  const { authorizeUrl, cookieValue } = beginMailboxAuthorization(ORG, 'identity-admin');
  return { cookieValue, state: new URL(authorizeUrl).searchParams.get('state')! };
}

type Reply = { status: number; body: unknown } | 'network';
function microsoft(token: Reply, me: Reply = { status: 200, body: { mail: 'office@funeralhome.example' } }) {
  const fetch = vi.fn(async (url: string) => {
    const reply = String(url).includes('/token') ? token : me;
    if (reply === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

let logged: string[];
beforeEach(() => {
  vi.stubEnv('MICROSOFT_CLIENT_ID', 'fictional-client-id');
  vi.stubEnv('MICROSOFT_CLIENT_SECRET', SECRET);
  vi.stubEnv('MICROSOFT_MAIL_REDIRECT_URI', 'https://solis.example/api/organization/crematory-settings/mailbox/callback');
  resetMockCrematoryMailboxes();
  wix.query.mockReset();
  wix.update.mockReset();
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const nothingSensitive = (text: string) => {
  for (const secret of [SECRET, ACCESS, REFRESH, CODE]) expect(text).not.toContain(secret);
};

async function attempt(mode: 'mock' | 'wix' = 'mock') {
  const { cookieValue, state } = begin();
  try {
    await completeMailboxAuthorization(CODE, cookieValue, state, ORG, mode);
    return null;
  } catch (error) {
    return error as InstanceType<typeof MailboxConnectError>;
  }
}

describe('connecting the Outlook mailbox — each step fails on its own', () => {
  it('success: connected, and the account Microsoft reports is shown', async () => {
    microsoft({ status: 200, body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 } });
    expect(await attempt()).toBeNull();
    expect(await getCrematoryMailboxStatus(ORG, 'mock')).toMatchObject({ connected: true, accountEmail: 'office@funeralhome.example' });
    expect(logged).toEqual([]);
  });

  it('token exchange rejected (wrong or expired secret): names the step, the code and the status', async () => {
    microsoft({ status: 401, body: { error: 'invalid_client', error_description: `AADSTS7000215: Invalid client secret provided ${SECRET}` } });
    const error = await attempt();
    expect(error).toBeInstanceOf(MailboxConnectError);
    expect(error!.diagnostic).toEqual({ operation: 'mailbox_connect', stage: 'token_exchange', category: 'invalid_client', httpStatus: 401 });
    expect(error!.message).toContain("rejected SOLIS's app credentials (invalid_client)");
    nothingSensitive(error!.message);
  });

  it('token exchange: code already used, network failure, or no refresh token', async () => {
    microsoft({ status: 400, body: { error: 'invalid_grant' } });
    expect((await attempt())!.diagnostic).toMatchObject({ stage: 'token_exchange', category: 'invalid_grant', httpStatus: 400 });
    microsoft('network');
    expect((await attempt())!.diagnostic).toMatchObject({ stage: 'token_exchange', category: 'network_error', httpStatus: null });
    microsoft({ status: 200, body: { access_token: ACCESS } });
    expect((await attempt())!.diagnostic).toMatchObject({ stage: 'token_exchange', category: 'no_refresh_token' });
  });

  it('mailbox lookup failing still connects (unchanged behaviour), and is logged', async () => {
    microsoft({ status: 200, body: { access_token: ACCESS, refresh_token: REFRESH } }, { status: 403, body: { error: { code: 'Authorization_RequestDenied' } } });
    expect(await attempt()).toBeNull();
    expect(await getCrematoryMailboxStatus(ORG, 'mock')).toMatchObject({ connected: true, accountEmail: 'Unknown account' });
    expect(logged).toEqual([`[crematory-mailbox] ${JSON.stringify({ operation: 'mailbox_connect', stage: 'mailbox_lookup', category: 'graph_rejected', httpStatus: 403 })}`]);
  });

  it('token encryption failing (no key in production): named, nothing connected', async () => {
    microsoft({ status: 200, body: { access_token: ACCESS, refresh_token: REFRESH } });
    vi.stubEnv('SESSION_JWT_SECRET', 'fictional-session-secret');
    const { cookieValue, state } = begin();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CALENDAR_TOKEN_ENCRYPTION_KEY', '');
    const error = await completeMailboxAuthorization(CODE, cookieValue, state, ORG, 'mock').then(() => null, (e) => e as InstanceType<typeof MailboxConnectError>);
    expect(error!.diagnostic).toEqual({ operation: 'mailbox_connect', stage: 'token_encryption', category: 'encryption_failed', httpStatus: null });
    expect(await getCrematoryMailboxStatus(ORG, 'mock')).toMatchObject({ connected: false });
  });

  it('saving to the organization settings refused by Wix: named with Wix\'s HTTP status', async () => {
    microsoft({ status: 200, body: { access_token: ACCESS, refresh_token: REFRESH } });
    wix.query.mockResolvedValue({ dataItems: [{ id: ORG, data: { beaconOrganizationId: ORG } }] });
    wix.update.mockRejectedValue(new WixDataApiError('Wix Data update failed for collection "organizations" (HTTP 400).', 400));
    const error = await attempt('wix');
    expect(error!.diagnostic).toEqual({ operation: 'mailbox_connect', stage: 'save_settings', category: 'wix_rejected', httpStatus: 400 });
    expect(error!.message).toBe('Microsoft sign-in worked, but SOLIS could not save the mailbox to the organization settings (Wix HTTP 400). Nothing was connected.');
    // What was sent to Wix was encrypted — never the tokens themselves.
    nothingSensitive(JSON.stringify(wix.update.mock.calls));
  });

  it('organization missing in Wix: named as a save failure', async () => {
    microsoft({ status: 200, body: { access_token: ACCESS, refresh_token: REFRESH } });
    wix.query.mockResolvedValue({ dataItems: [] });
    expect((await attempt('wix'))!.diagnostic).toMatchObject({ stage: 'save_settings', category: 'organization_not_found', httpStatus: 404 });
  });

  it('no log line or message ever carries a token, code or secret', async () => {
    for (const reply of [
      { status: 401, body: { error: 'invalid_client', error_description: SECRET } },
      { status: 400, body: { error: `weird ${ACCESS}` } },
    ] as const) {
      microsoft(reply);
      const error = await attempt();
      nothingSensitive(error!.message);
      nothingSensitive(JSON.stringify(error!.diagnostic));
    }
    nothingSensitive(logged.join('\n'));
  });
});

describe('safe codes', () => {
  it('keeps only Microsoft\'s OAuth code vocabulary and the AADSTS number', () => {
    expect(safeOAuthErrorCode('invalid_client')).toBe('invalid_client');
    expect(safeOAuthErrorCode('Bearer abc.def')).toBe('other');
    expect(aadstsCode('AADSTS50194: Application is not configured as a multi-tenant application. Trace ID: x')).toBe('AADSTS50194');
    expect(aadstsCode('no code here')).toBeNull();
  });
});
