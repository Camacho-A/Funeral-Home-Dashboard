// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockAccountingUser, mockArrangerUser, mockDefaultUser, mockDispatchUser, mockFuneralDirectorUser, mockManagerUser, mockOfficeStaffUser, mockReadOnlyUser } from '@/services/__mocks__/authFixtures';

/**
 * Fax test transmission routes (2026-11): administrators of the signed-in
 * session's own organization only. Fictional recipients; Graph simulated.
 */
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
const recipients = vi.hoisted(() => ({ value: null as { faxNumbers: string[]; emailAddresses: string[] } | null }));
vi.mock('@/domain/faxBundles/faxSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/faxBundles/faxSettings')>();
  return { ...actual, deathCertificateFaxSettings: (id: string | null | undefined) => { const real = actual.deathCertificateFaxSettings(id); return real && recipients.value ? { ...real, testRecipients: recipients.value } : real; } };
});

const route = await import('./route');
const outcomeRoute = await import('./[transmissionId]/outcome/route');
const { memoryFaxTable } = await import('@/services/faxBundles/faxBundleStore');
const { activityEventFixtures } = await import('@/services/__mocks__/activityEventFixtures');
const { connectMockCrematoryMailbox, resetMockCrematoryMailboxes } = await import('@/services/crematory/crematoryMailboxService');

const ORG = DEFAULT_ORGANIZATION_ID;
const HEADERS = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const as = (user: typeof mockDefaultUser | null) => (mockSession = user ? { user } : null);
const get = (org = ORG) => route.GET(new Request(`http://localhost/api/organization/fax-settings/test-transmissions?organizationId=${org}`));
const post = (body: Record<string, unknown>, headers: Record<string, string> = HEADERS) =>
  route.POST(new Request('http://localhost/api/organization/fax-settings/test-transmissions', { method: 'POST', headers, body: JSON.stringify({ organizationId: ORG, ...body }) }));
const outcome = (id: string, body: Record<string, unknown>) =>
  outcomeRoute.POST(new Request(`http://localhost/x/${id}/outcome`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, ...body }) }), { params: Promise.resolve({ transmissionId: id }) });
const dryRun = (submissionId: string) => ({ step: 0, recipientKey: 'email:dry-run@example.test', submissionId, confirm: { acknowledged: true, recipient: 'dry-run@example.test', pages: 1 } });

let graphSends = 0;
let activityLength = 0;
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  as(mockDefaultUser);
  memoryFaxTable.reset();
  resetMockCrematoryMailboxes();
  connectMockCrematoryMailbox(ORG, 'office@funeralhome.example', 'access-token');
  recipients.value = null;
  graphSends = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/me/messages') && init?.method === 'POST') return new Response(JSON.stringify({ id: 'draft-1', internetMessageId: '<t@example>' }), { status: 201 });
      if (url.endsWith('/send')) return (graphSends++, new Response(null, { status: 202 }));
      return new Response('{}', { status: 201 });
    }),
  );
  activityLength = activityEventFixtures.length;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  vi.unstubAllGlobals();
  activityEventFixtures.length = activityLength;
});

describe('fax test transmission routes', () => {
  it('need a session and the member\'s own organization; changes need a same-origin request', async () => {
    as(null);
    expect((await get()).status).toBe(401);
    as(mockDefaultUser);
    expect((await get(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
    recipients.value = { faxNumbers: [], emailAddresses: ['dry-run@example.test'] };
    expect((await post(dryRun('submission-0001'), { host: 'localhost', 'content-type': 'application/json' })).status).toBe(403);
    expect(graphSends).toBe(0);
  });

  it.each([
    ['Manager', mockManagerUser],
    ['Funeral Director', mockFuneralDirectorUser],
    ['Office Staff', mockOfficeStaffUser],
    ['Arranger', mockArrangerUser],
    ['Accounting', mockAccountingUser],
    ['Read Only', mockReadOnlyUser],
    ['Dispatch', mockDispatchUser],
  ])('%s can neither see nor run fax tests', async (_label, user) => {
    recipients.value = { faxNumbers: [], emailAddresses: ['dry-run@example.test'] };
    as(user);
    expect((await get()).status).toBe(403);
    expect((await post(dryRun('submission-0002'))).status).toBe(403);
    expect((await outcome('fxt-' + '0'.repeat(40), { status: 'failed', expectedRevision: 0 })).status).toBe(403);
    expect(graphSends).toBe(0);
    expect(memoryFaxTable.rows('faxTestTransmissions')).toHaveLength(0);
  });

  it('with Manors\' real (empty) allowlist the feature is off: listed as off, every send refused', async () => {
    const overview = (await (await get()).json()).overview;
    expect(overview).toMatchObject({ enabled: false, recipients: [], sendingEnabled: false });
    const refused = await post(dryRun('submission-0003'));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/Test transmissions are off/);
    expect(graphSends).toBe(0);
  });

  it('an administrator runs the dry run end to end: one send, the same request again sends nothing, then the outcome is recorded', async () => {
    recipients.value = { faxNumbers: [], emailAddresses: ['dry-run@example.test'] };
    const overview = (await (await get()).json()).overview;
    expect(overview.recipients).toEqual([{ key: 'email:dry-run@example.test', kind: 'email_dry_run', display: 'dry-run@example.test' }]);
    expect(JSON.stringify(overview)).not.toContain('access-token');
    const first = await post(dryRun('submission-0004'));
    expect(first.status).toBe(200);
    const { transmission } = await first.json();
    expect(transmission).toMatchObject({ status: 'submitted', open: true });
    expect((await (await post(dryRun('submission-0004'))).json()).duplicate).toBe(true);
    expect((await post(dryRun('submission-0005'))).status).toBe(409);
    expect(graphSends).toBe(1);
    const checks = Object.fromEntries(overview.dryRunChecks.map((c: { key: string }) => [c.key, true]));
    const recorded = await outcome(transmission.id, { status: 'delivered', expectedRevision: transmission.revision, checks });
    expect(recorded.status).toBe(200);
    expect((await recorded.json()).transmission).toMatchObject({ passed: true, open: false });
    expect(memoryFaxTable.rows('faxBundles')).toHaveLength(0);
  });
});
