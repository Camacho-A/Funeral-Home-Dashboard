// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockAccountingUser, mockArrangerUser, mockDefaultUser, mockDispatchUser, mockFuneralDirectorUser, mockManagerUser, mockMultiOrgUser, mockOfficeStaffUser, mockReadOnlyUser } from '@/services/__mocks__/authFixtures';
import type { CaseDocument } from '@/types/caseDocument';

/**
 * Fax bundle routes (2026-11): who may do what, always for the
 * organization of the signed-in session. Fictional data; Graph faked.
 */
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, Buffer>() }));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string, contents: Buffer) => (blobs.set(key, Buffer.from(contents)), { storageKey: key }),
    downloadFile: async (key: string) => ({ buffer: Buffer.from(blobs.get(key) ?? Buffer.alloc(0)), contentType: 'application/pdf' }),
    deleteFile: async (key: string) => void blobs.delete(key),
  },
}));
vi.mock('@/domain/faxBundles/faxSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/faxBundles/faxSettings')>();
  return { ...actual, deathCertificateFaxSettings: (id: string | null | undefined) => { const s = actual.deathCertificateFaxSettings(id); return s ? { ...s, sendingEnabled: true } : null; } };
});

const list = await import('./route');
const bundleRoute = await import('./[bundleId]/route');
const pdfRoute = await import('./[bundleId]/pdf/route');
const sendRoute = await import('./[bundleId]/send/route');
const outcomeRoute = await import('./[bundleId]/outcome/route');
const historyRoute = await import('../cases/[caseId]/fax-bundles/route');
const { memoryFaxTable } = await import('@/services/faxBundles/faxBundleStore');
const { caseFixtures } = await import('@/services/__mocks__/fixtures');
const { caseDocumentFixtures } = await import('@/services/__mocks__/documentFixtures');
const { buildManateeApplicationPdf } = await import('@/services/manateeApplicationTemplate');
const { buildManateeTemplateFixture } = await import('@/services/__mocks__/manateeTemplateFixture');
const { connectMockCrematoryMailbox, resetMockCrematoryMailboxes } = await import('@/services/crematory/crematoryMailboxService');

const ORG = DEFAULT_ORGANIZATION_ID;
const HEADERS = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const as = (user: typeof mockDefaultUser | null) => (mockSession = user ? { user } : null);
const params = (bundleId: string) => ({ params: Promise.resolve({ bundleId }) });

const getList = (org = ORG) => list.GET(new Request(`http://localhost/api/fax-bundles?organizationId=${org}`));
const preview = (caseIds: string[], org = ORG, headers: Record<string, string> = HEADERS) =>
  list.POST(new Request('http://localhost/api/fax-bundles', { method: 'POST', headers, body: JSON.stringify({ organizationId: org, caseIds }) }));
const send = (bundleId: string, org = ORG) =>
  sendRoute.POST(new Request(`http://localhost/api/fax-bundles/${bundleId}/send`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: org, submissionId: 'submission-0001' }) }), params(bundleId));
const outcome = (bundleId: string, fields: Record<string, string>, org = ORG) => {
  const form = new FormData();
  form.set('organizationId', org);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return outcomeRoute.POST(new Request(`http://localhost/api/fax-bundles/${bundleId}/outcome`, { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: form }), params(bundleId));
};

let lengths = { cases: 0, documents: 0 };
const CASE = 'fx-route-case';
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  as(mockDefaultUser);
  memoryFaxTable.reset();
  resetMockCrematoryMailboxes();
  connectMockCrematoryMailbox(ORG, 'office@funeralhome.example', 'token');
  lengths = { cases: caseFixtures.length, documents: caseDocumentFixtures.length };
  const base = caseFixtures.find((c) => c.id === '1042' && c.organizationId === ORG)!;
  caseFixtures.push({ ...structuredClone(base), id: CASE, caseNumber: 'B2026-990', decedentName: 'ALPHA TESTCASE', isDeleted: false, checklistState: {}, checklistCompletions: {} });
  const bytes = await buildManateeApplicationPdf(await buildManateeTemplateFixture(), {
    decedentFirst: 'Alpha', decedentMiddle: '', decedentLast: 'Testcase', decedentSex: 'F', ssn: '000123456', ssnNotKnown: false, dateOfDeath: '10/04/2026',
    placeOfDeathCity: 'Pembroke Pines', placeOfDeathCounty: 'Broward', spouseFirst: '', spouseMiddle: '', spouseLast: '', representedName: 'Teresa Testcase',
    representedRelationship: 'Daughter', withCause: 1, withoutCause: 0, fedexFee: false, requestNumber: '', requestOf: '',
  });
  const key = `${ORG}/${CASE}/fx-route-doc.pdf`;
  blobs.set(key, Buffer.from(bytes));
  caseDocumentFixtures.push({
    id: 'fx-route-doc', organizationId: ORG, caseId: CASE, origin: 'generated', documentTypeKey: 'vital_records.manatee_death_certificate_application', category: 'internal_form',
    fileName: 'Manatee County Death Certificate Application.pdf', mimeType: 'application/pdf', fileSizeBytes: bytes.byteLength, storageKey: key, status: 'active', templateId: null,
    templateVersion: null, version: 1, supersedesId: null, signatureStatus: null, familyVisible: false, generatedBy: 'staff', uploadedBy: null, createdAt: new Date().toISOString(),
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
  } as unknown as CaseDocument);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/me/messages') && init?.method === 'POST') return new Response(JSON.stringify({ id: 'draft-1', internetMessageId: '<m@example>' }), { status: 201 });
    return new Response(url.endsWith('/send') ? null : '{}', { status: url.endsWith('/send') ? 202 : 201 });
  }));
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  caseFixtures.length = lengths.cases;
  caseDocumentFixtures.length = lengths.documents;
  blobs.clear();
  vi.unstubAllGlobals();
});

describe('fax bundle routes', () => {
  it('requires a session, and never trusts the requested organization on its own', async () => {
    as(null);
    expect((await getList()).status).toBe(401);
    as(mockDefaultUser);
    expect((await getList(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
    expect((await preview([CASE], SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('an organization without fax bundles gets 404, even for its own members', async () => {
    as(mockMultiOrgUser);
    expect((await getList(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(404);
  });

  // The approved fax matrix (2026-11): fax.send — prepare, preview, send; fax.confirm — record the result.
  const MATRIX: Array<[string, typeof mockDefaultUser, { send: boolean; confirm: boolean }]> = [
    ['Administrator', mockDefaultUser, { send: true, confirm: true }],
    ['Manager', mockManagerUser, { send: true, confirm: true }],
    ['Funeral Director', mockFuneralDirectorUser, { send: true, confirm: true }],
    ['Office Staff', mockOfficeStaffUser, { send: true, confirm: true }],
    ['Arranger', mockArrangerUser, { send: true, confirm: false }],
    ['Accounting', mockAccountingUser, { send: false, confirm: false }],
    ['Read Only', mockReadOnlyUser, { send: false, confirm: false }],
    ['Dispatch', mockDispatchUser, { send: false, confirm: false }],
  ];

  it.each(MATRIX)('%s: prepare, preview and send — per the fax matrix', async (_label, user, allowed) => {
    as(user);
    expect((await getList()).status).toBe(allowed.send ? 200 : 403);
    const created = await preview([CASE]);
    expect(created.status).toBe(allowed.send ? 201 : 403);
    if (!allowed.send) {
      expect((await send('fxb-00000000000000000000000000000000')).status).toBe(403);
      return;
    }
    const { bundle } = (await created.json()) as { bundle: { id: string } };
    expect((await pdfRoute.GET(new Request(`http://localhost/api/fax-bundles/${bundle.id}/pdf?organizationId=${ORG}`), params(bundle.id))).status).toBe(200);
    expect((await send(bundle.id)).status).toBe(200);
  });

  it.each(MATRIX)('%s: record delivered / failed — per the fax matrix', async (_label, user, allowed) => {
    as(mockDefaultUser);
    const { bundle } = (await (await preview([CASE])).json()) as { bundle: { id: string } };
    expect((await send(bundle.id)).status).toBe(200);
    as(user);
    const response = await outcome(bundle.id, { decision: 'delivered', nusoReference: 'NS-1' });
    expect(response.status).toBe(allowed.confirm ? 200 : 403);
    as(mockDefaultUser);
    const view = await bundleRoute.GET(new Request(`http://localhost/api/fax-bundles/${bundle.id}?organizationId=${ORG}`), params(bundle.id));
    expect(((await view.json()) as { bundle: { state: string } }).bundle.state).toBe(allowed.confirm ? 'delivered' : 'submitted');
  });

  it('refuses a cross-site POST', async () => {
    expect((await preview([CASE], ORG, { ...HEADERS, origin: 'https://elsewhere.example' })).status).toBe(403);
  });

  it('an Administrator previews, reads the exact PDF (private, never cached), sends; only a member with fax.confirm records delivery', async () => {
    const created = await preview([CASE]);
    expect(created.status).toBe(201);
    const { bundle } = (await created.json()) as { bundle: { id: string; reference: string; applicationCount: number } };
    expect(bundle.applicationCount).toBe(1);

    const pdf = await pdfRoute.GET(new Request(`http://localhost/api/fax-bundles/${bundle.id}/pdf?organizationId=${ORG}`), params(bundle.id));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('cache-control')).toBe('private, no-store');
    expect(pdf.headers.get('x-content-type-options')).toBe('nosniff');

    expect((await send(bundle.id)).status).toBe(200);
    as(mockArrangerUser);
    expect((await outcome(bundle.id, { decision: 'delivered' })).status).toBe(403);
    as(mockManagerUser);
    const recorded = await outcome(bundle.id, { decision: 'delivered', nusoReference: 'NS-1' });
    expect(recorded.status).toBe(200);
    expect(((await recorded.json()) as { bundle: { state: string } }).bundle.state).toBe('delivered');

    as(mockDefaultUser);
    const view = await bundleRoute.GET(new Request(`http://localhost/api/fax-bundles/${bundle.id}?organizationId=${ORG}`), params(bundle.id));
    expect(((await view.json()) as { bundle: { nusoReference: string } }).bundle.nusoReference).toBe('NS-1');
    const history = await historyRoute.GET(new Request(`http://localhost/api/cases/${CASE}/fax-bundles?organizationId=${ORG}`), { params: Promise.resolve({ caseId: CASE }) });
    expect(((await history.json()) as { history: Array<{ reference: string; state: string }> }).history).toEqual([expect.objectContaining({ reference: bundle.reference, state: 'delivered' })]);
  });

  it('a refused preview names each case and why', async () => {
    const response = await preview([CASE, 'no-such-case']);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ caseProblems: [{ caseId: 'no-such-case', reason: 'Case not found.' }] });
  });
});
