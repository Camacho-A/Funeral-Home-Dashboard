import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockOrganizationFixtures } from '@/services/__mocks__/authFixtures';

/**
 * Send to Crematory (2026-10) — the routes' permissions and settings, in
 * mock mode with fictional data. The full prepare/build/send flow is
 * covered in services/crematory/crematory.flow.test.ts.
 */
let session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'identity-admin', role: 'administrator' };
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) =>
    requested !== session.organizationId
      ? { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) }
      : { authorized: true, context: { organizationId: requested, userId: session.userId, role: session.role } },
  ),
}));
const permissions = vi.hoisted(() => ({ read: true, send: true, manage: true }));
vi.mock('@/services/authorizationPolicyService', async () => {
  const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>('@/services/authorizationPolicyService');
  return {
    ...actual,
    canReadCases: vi.fn(async () => permissions.read),
    canGenerateDocument: vi.fn(async () => permissions.send),
    canManageOrganization: vi.fn(async () => permissions.manage),
  };
});

const overview = await import('./route');
const send = await import('./send/route');
const settings = await import('@/app/api/organization/crematory-settings/route');
const mailbox = await import('@/app/api/organization/crematory-settings/mailbox/route');
const caseRoute = await import('@/app/api/cases/[caseId]/crematory/route');
const { connectMockCrematoryMailbox, resetMockCrematoryMailboxes } = await import('@/services/crematory/crematoryMailboxService');

const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const org = () => session.organizationId;
const orgIndex = mockOrganizationFixtures.findIndex((o) => o.id === DEFAULT_ORGANIZATION_ID);
const originalOrg = mockOrganizationFixtures[orgIndex];

beforeEach(() => {
  resetMockCrematoryMailboxes();
  Object.assign(permissions, { read: true, send: true, manage: true });
});
afterEach(() => {
  session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'identity-admin', role: 'administrator' };
  mockOrganizationFixtures[orgIndex] = originalOrg;
  vi.unstubAllEnvs();
});

const getOverview = () => overview.GET(new Request(`http://localhost/api/crematory?organizationId=${org()}`));
const getSettings = () => settings.GET(new Request(`http://localhost/api/organization/crematory-settings?organizationId=${org()}`));
const patchSettings = (body: unknown, headers = SAME_ORIGIN) =>
  settings.PATCH(new Request('http://localhost/api/organization/crematory-settings', { method: 'PATCH', headers, body: JSON.stringify({ organizationId: org(), settings: body }) }));
const postSend = (body: Record<string, unknown>, headers = SAME_ORIGIN) => send.POST(new Request('http://localhost/api/crematory/send', { method: 'POST', headers, body: JSON.stringify({ organizationId: org(), ...body }) }));

describe('Send to Crematory routes', () => {
  it('the overview lists cases, recipients, the mailbox — and never any token', async () => {
    connectMockCrematoryMailbox(DEFAULT_ORGANIZATION_ID, 'office@funeralhome.example', 'secret-access-token');
    const response = await getOverview();
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ organizationName: 'Manors Cremation', mailbox: { connected: true, accountEmail: 'office@funeralhome.example' }, canSend: true });
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(text).not.toContain('secret-access-token');
    expect(text).not.toMatch(/Ciphertext|refreshToken|accessToken/);
  });

  it('administrators save recipients — validated, never a built-in address', async () => {
    expect(await (await getSettings()).json()).toMatchObject({ settings: { to: [], cc: [] }, mailbox: { connected: false } });
    const saved = await patchSettings({ to: ['intake@crematory.example', 'INTAKE@crematory.example'], cc: ['office@funeralhome.example'] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ settings: { to: ['intake@crematory.example'], cc: ['office@funeralhome.example'] } });
    expect((await patchSettings({ to: ['not-an-email'] })).status).toBe(400);
    expect((await patchSettings({ to: ['a@b.example'] }, { ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('settings and the mailbox are for administrators only', async () => {
    permissions.manage = false;
    expect((await getSettings()).status).toBe(403);
    expect((await patchSettings({ to: ['a@b.example'] })).status).toBe(403);
    expect((await mailbox.POST(new Request('http://localhost/x', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: org() }) }))).status).toBe(403);
  });

  it('connecting the mailbox needs the Microsoft app configured; when it is, returns a Microsoft sign-in asking only for mail scopes', async () => {
    const start = () => mailbox.POST(new Request('http://localhost/x', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: org() }) }));
    vi.stubEnv('MICROSOFT_MAIL_REDIRECT_URI', '');
    expect((await start()).status).toBe(503);
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'client-id');
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('MICROSOFT_MAIL_REDIRECT_URI', 'http://localhost/api/organization/crematory-settings/mailbox/callback');
    const response = await start();
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).authorizeUrl);
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.searchParams.get('scope')).toBe('Mail.ReadWrite Mail.Send offline_access openid profile email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.headers.get('set-cookie')).toContain('beacon_crematory_mailbox_oauth_state=');
  });

  it('preparing and sending need document permission; viewing needs case read', async () => {
    permissions.send = false;
    const confirm = await caseRoute.POST(
      new Request('http://localhost/api/cases/1042/crematory', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: org(), action: 'build_package' }) }),
      { params: Promise.resolve({ caseId: '1042' }) },
    );
    expect(confirm.status).toBe(403);
    expect((await postSend({ caseIds: ['1042'], to: ['intake@crematory.example'], cc: [], subject: 's', message: '', submissionId: 'sub-0000-0001' })).status).toBe(403);
    expect(await (await getOverview()).json()).toMatchObject({ canSend: false });
    permissions.read = false;
    expect((await getOverview()).status).toBe(403);
  });

  it('sending refuses a malformed request and a case that is not ready — nothing is sent', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await postSend({ caseIds: 'all' })).status).toBe(400);
    const response = await postSend({ caseIds: ['1042'], to: ['intake@crematory.example'], cc: [], subject: 'Manors Cremation — Test', message: '', submissionId: 'sub-0000-0001' });
    expect(response.status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('an organization without Send to Crematory gets nothing', async () => {
    session = { ...session, organizationId: SECOND_MOCK_ORGANIZATION_ID };
    expect((await getOverview()).status).toBe(404);
    expect((await getSettings()).status).toBe(404);
    expect((await postSend({ caseIds: ['x'] })).status).toBe(404);
  });
});
