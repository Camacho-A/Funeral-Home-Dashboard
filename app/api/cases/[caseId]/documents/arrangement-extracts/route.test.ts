import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Case } from '@/types/case';

/** ME Form / Crematory Form (2026-10). Real route + service, mock data, in-memory storage. */
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, Buffer>() }));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string, contents: Buffer) => (blobs.set(key, Buffer.from(contents)), { storageKey: key }),
    downloadFile: async (key: string) => ({ buffer: blobs.get(key)!, contentType: 'application/pdf' }),
    deleteFile: async () => undefined,
  },
}));
let session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'staff-dana', role: 'administrator' };
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) =>
    requested !== session.organizationId
      ? { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) }
      : { authorized: true, context: { organizationId: requested, userId: session.userId, role: session.role } },
  ),
}));
const { canReadCases, canGenerateDocument } = vi.hoisted(() => ({ canReadCases: vi.fn(async () => true), canGenerateDocument: vi.fn(async () => true) }));
vi.mock('@/services/authorizationPolicyService', async () => {
  const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>('@/services/authorizationPolicyService');
  return { ...actual, canReadCases, canGenerateDocument };
});

const { GET, POST } = await import('./route');
const { upload } = await import('@/services/documentService');

const CASE_ID = '1042';
const index = caseFixtures.findIndex((c) => c.id === CASE_ID && c.organizationId === DEFAULT_ORGANIZATION_ID);
const original: Case = caseFixtures[index];
let lengths = { documents: 0, activity: 0 };
beforeEach(async () => {
  lengths = { documents: caseDocumentFixtures.length, activity: activityEventFixtures.length };
  caseFixtures[index] = { ...original, isMedicalExaminerCase: true, slaEvents: {}, checklistState: {} };
  const doc = await PDFDocument.create();
  for (let n = 0; n < 6; n++) doc.addPage([612, 792]).drawText(`page ${n + 1}`);
  await upload(
    { caseId: CASE_ID, fileName: 'Arrangement Forms.pdf', mimeType: 'application/pdf', documentTypeKey: 'external_form.arrangement_forms', idFactory: () => 'arr-route' },
    Buffer.from(await doc.save()),
    { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'staff-dana', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c' },
    'mock',
  );
});
afterEach(() => {
  caseFixtures[index] = original;
  caseDocumentFixtures.length = lengths.documents;
  activityEventFixtures.length = lengths.activity;
  blobs.clear();
  session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'staff-dana', role: 'administrator' };
  vi.clearAllMocks();
});

const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const get = () => GET(new Request(`http://localhost/api/cases/${CASE_ID}/documents/arrangement-extracts?organizationId=${session.organizationId}`), { params: Promise.resolve({ caseId: CASE_ID }) });
const post = (body: Record<string, unknown>, headers: Record<string, string> = SAME_ORIGIN) =>
  POST(new Request(`http://localhost/api/cases/${CASE_ID}/documents/arrangement-extracts`, { method: 'POST', headers, body: JSON.stringify({ organizationId: session.organizationId, ...body }) }), {
    params: Promise.resolve({ caseId: CASE_ID }),
  });

describe('/api/cases/[caseId]/documents/arrangement-extracts', () => {
  it('extracts the ME Form (201), then reports it unchanged (200)', async () => {
    const first = await post({ kind: 'me_form' });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ outcome: 'saved', version: 1 });
    expect(await (await post({ kind: 'me_form' })).json()).toMatchObject({ outcome: 'unchanged' });
    expect((await (await get()).json()).latest.me_form).toMatchObject({ version: 1 });
  });

  it('the Crematory Form asks for permit confirmation (428) unless staff confirm it', async () => {
    expect((await post({ kind: 'crematory_form' })).status).toBe(428);
    expect((await post({ kind: 'crematory_form', permitVerifiedByStaff: true })).status).toBe(201);
  });

  it('extracting needs document permission; reading needs case read; another site is refused', async () => {
    canGenerateDocument.mockResolvedValueOnce(false);
    expect((await post({ kind: 'me_form' })).status).toBe(403);
    expect((await post({ kind: 'me_form' }, { ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);
    canReadCases.mockResolvedValueOnce(false);
    expect((await get()).status).toBe(403);
    expect(caseDocumentFixtures.filter((d) => d.documentTypeKey === 'external_form.me_form')).toHaveLength(0);
  });

  it('rejects an unknown kind, and an organization without these forms', async () => {
    expect((await post({ kind: 'page_9' })).status).toBe(400);
    session = { ...session, organizationId: SECOND_MOCK_ORGANIZATION_ID };
    expect((await get()).status).toBe(404);
    expect((await post({ kind: 'me_form' })).status).toBe(404);
  });
});
