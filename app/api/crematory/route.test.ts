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
const permissions = vi.hoisted(() => ({ read: true, prepare: true, send: true, manage: true }));
vi.mock('@/services/authorizationPolicyService', async () => {
  const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>('@/services/authorizationPolicyService');
  return {
    ...actual,
    canReadCases: vi.fn(async () => permissions.read),
    canGenerateDocument: vi.fn(async () => permissions.prepare),
    canSendToCrematory: vi.fn(async () => permissions.send),
    canManageOrganization: vi.fn(async () => permissions.manage),
  };
});

const overview = await import('./route');
const send = await import('./send/route');
const review = await import('./review/route');
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
  Object.assign(permissions, { read: true, prepare: true, send: true, manage: true });
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

  it('sending needs its own permission — document permission alone never sends; preparing still works without it', async () => {
    permissions.send = false;
    const prepare = await caseRoute.POST(
      new Request('http://localhost/api/cases/1042/crematory', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: org(), action: 'confirm_ready_date', date: '11/06/2026' }) }),
      { params: Promise.resolve({ caseId: '1042' }) },
    );
    expect(prepare.status).not.toBe(403);
    expect((await postSend({ caseIds: ['1042'], to: ['intake@crematory.example'], cc: [], subject: 's', message: '', submissionId: 'sub-0000-0001', confirmResend: true })).status).toBe(403);
    expect(await (await getOverview()).json()).toMatchObject({ canSend: false, canPrepare: true });
  });

  it('recording a possible earlier send needs the send permission (2026-10)', async () => {
    permissions.send = false;
    const response = await caseRoute.POST(
      new Request('http://localhost/api/cases/1042/crematory', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: org(), action: 'record_previous_send', decision: 'not_previously_sent', verification: 'Checked Sent Items', confirmedChecked: true }) }),
      { params: Promise.resolve({ caseId: '1042' }) },
    );
    expect(response.status).toBe(403);
  });

  it('correcting an earlier-send record is for administrators only (2026-10); confirming a permit needs the PDF shown', async () => {
    const post = (body: Record<string, unknown>) =>
      caseRoute.POST(new Request('http://localhost/api/cases/1042/crematory', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: org(), ...body }) }), { params: Promise.resolve({ caseId: '1042' }) });
    permissions.manage = false;
    const refused = await post({ action: 'correct_previous_send', reason: 'Recorded on the wrong case', decision: 'not_previously_sent', verification: 'Checked Sent Items', confirmedChecked: true });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain('Only an administrator');
    permissions.manage = true;
    // An administrator gets past the permission check (nothing is recorded on this case to correct).
    expect((await post({ action: 'correct_previous_send', reason: 'Recorded on the wrong case', decision: 'not_previously_sent', verification: 'Checked Sent Items', confirmedChecked: true })).status).toBe(409);
    expect(await (await getOverview()).json()).toMatchObject({ canManage: true });
  });

  it('resolving a send SOLIS could not confirm is for administrators only (2026-10)', async () => {
    const post = (body: Record<string, unknown>) =>
      caseRoute.POST(new Request('http://localhost/api/cases/1042/crematory', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: org(), ...body }) }), { params: Promise.resolve({ caseId: '1042' }) });
    permissions.manage = false;
    permissions.send = true;
    const refused = await post({ action: 'reconcile_send', decision: 'not_sent', reason: 'Not in Sent Items' });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain('Only an administrator');
    permissions.manage = true;
    // An administrator gets past the permission check (this case has no send to resolve).
    expect((await post({ action: 'reconcile_send', decision: 'not_sent', reason: 'Not in Sent Items' })).status).toBe(409);
  });

  it('preparing needs document permission; viewing needs case read', async () => {
    permissions.prepare = false;
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
    const body = { caseIds: ['1042'], to: ['intake@crematory.example'], cc: [], subject: 'Manors Cremation — Test', message: '', submissionId: 'sub-0000-0001' };
    // Without the final review (a window opened before 2026-10's update): refused, nothing sent.
    const unreviewed = await postSend(body);
    expect(unreviewed.status).toBe(409);
    expect((await unreviewed.json()).error).toContain('Send to Crematory was updated');
    expect((await postSend({ ...body, reviewFingerprint: 'v1:x' })).status).toBe(400);
    expect((await postSend({ ...body, reviewFingerprint: 'v1:x', acknowledged: true })).status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("one case's status tells the Documents tab whether this staff member may replace the permit (2026-10)", async () => {
    const getCase = () => caseRoute.GET(new Request(`http://localhost/api/cases/1042/crematory?organizationId=${org()}`), { params: Promise.resolve({ caseId: '1042' }) });
    expect(await (await getCase()).json()).toMatchObject({ caseId: '1042', canPrepare: true });
    permissions.prepare = false;
    expect(await (await getCase()).json()).toMatchObject({ caseId: '1042', canPrepare: false });
  });

  it('the final review needs the send permission, and refuses a case that is not ready (2026-10)', async () => {
    const postReview = (body: Record<string, unknown>) => review.POST(new Request('http://localhost/api/crematory/review', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: org(), ...body }) }));
    expect((await postReview({ caseIds: 'all' })).status).toBe(400);
    expect((await postReview({ caseIds: ['1042'] })).status).toBe(422);
    permissions.send = false;
    expect((await postReview({ caseIds: ['1042'] })).status).toBe(403);
    expect((await review.POST(new Request('http://localhost/api/crematory/review', { method: 'POST', headers: { ...SAME_ORIGIN, origin: 'http://evil.test' }, body: '{}' }))).status).toBe(403);
  });

  it('an organization without Send to Crematory gets nothing', async () => {
    session = { ...session, organizationId: SECOND_MOCK_ORGANIZATION_ID };
    expect((await getOverview()).status).toBe(404);
    expect((await getSettings()).status).toBe(404);
    expect((await postSend({ caseIds: ['x'] })).status).toBe(404);
  });

  describe('Workflow 3 after a send (2026-10)', () => {
    const completeChecklist = (headers = SAME_ORIGIN, organizationId = org()) =>
      caseRoute.POST(
        new Request('http://localhost/api/cases/1042/crematory', { method: 'POST', headers, body: JSON.stringify({ organizationId, action: 'complete_sent_checklist' }) }),
        { params: Promise.resolve({ caseId: '1042' }) },
      );

    it('the checklist retry needs document permission, the same origin, and a case SOLIS actually sent — it never sends', async () => {
      permissions.prepare = false;
      expect((await completeChecklist()).status).toBe(403);
      permissions.prepare = true;
      expect((await completeChecklist({ ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);
      const notSent = await completeChecklist();
      expect(notSent.status).toBe(409);
      expect((await notSent.json()).error).toContain('has not been sent to the crematory through SOLIS');
    });

    it("another organization's request is refused for the retry and for sending", async () => {
      expect((await completeChecklist(SAME_ORIGIN, SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
      const crossOrgSend = await send.POST(
        new Request('http://localhost/api/crematory/send', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: SECOND_MOCK_ORGANIZATION_ID, caseIds: ['1042'] }) }),
      );
      expect(crossOrgSend.status).toBe(403);
      session = { ...session, organizationId: SECOND_MOCK_ORGANIZATION_ID };
      expect((await completeChecklist()).status).toBe(404);
    });
  });
});
