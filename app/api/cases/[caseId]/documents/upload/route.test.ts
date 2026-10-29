// @vitest-environment node
//
// This route is server-only and reads a multipart body via
// `request.formData()`. Under the project's global jsdom test environment,
// `FormData`/`File` are jsdom's classes while `Request` is Node's native
// (undici) one; undici doesn't recognise a foreign FormData, so it
// stringifies it ("[object FormData]", content-type text/plain) and
// `request.formData()` throws — the route then correctly answers 400 before
// ever reaching auth/permission checks. Running this file in Node's own
// environment (same as the sibling logo-upload and bulk-print route tests)
// uses one consistent, real implementation — the one Next.js uses in prod.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string) => ({ storageKey: key }),
    downloadFile: async () => ({ buffer: Buffer.from('fake'), contentType: 'application/pdf' }),
    deleteFile: async () => undefined,
  },
}));

const { POST } = await import('./route');

const TEST_CASE_ID = 'case-upload-route-test';

function uploadRequest(formData: FormData, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }, caseId = TEST_CASE_ID) {
  return POST(new Request(`http://localhost/api/cases/${caseId}/documents/upload`, { method: 'POST', headers, body: formData }), { params: Promise.resolve({ caseId }) });
}

function sampleFormData(overrides: Record<string, string> = {}, bytes = [1, 2, 3]) {
  const formData = new FormData();
  formData.set('organizationId', overrides.organizationId ?? DEFAULT_ORGANIZATION_ID);
  formData.set('file', new File([new Uint8Array(bytes)], overrides.fileName ?? 'scan.pdf', { type: overrides.mimeType ?? 'application/pdf' }));
  return formData;
}
/** A fictional case of the organization with Send to Crematory. */
const PERMIT_CASE_ID = '1042';
const permitUpload = (bytes: number[], extra: Record<string, string> = {}) => {
  const formData = sampleFormData({ fileName: 'FICTIONAL PERMIT.pdf' }, bytes);
  formData.set('documentTypeKey', 'cremation_form.state_permit');
  for (const [key, value] of Object.entries(extra)) formData.set(key, value);
  return uploadRequest(formData, undefined, PERMIT_CASE_ID);
};

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('POST /api/cases/[caseId]/documents/upload', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await uploadRequest(sampleFormData(), { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 400 when no file is provided', async () => {
    const formData = new FormData();
    formData.set('organizationId', DEFAULT_ORGANIZATION_ID);
    expect((await uploadRequest(formData)).status).toBe(400);
  });

  it('rejects an unsupported file type', async () => {
    const formData = sampleFormData({ mimeType: 'application/x-executable' });
    expect((await uploadRequest(formData)).status).toBe(400);
  });

  it('uploads a valid file and records document.uploaded', async () => {
    const response = await uploadRequest(sampleFormData());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.document.origin).toBe('uploaded');
    expect(body.document.fileName).toBe('scan.pdf');
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.uploaded');
  });

  it('an uploaded Arrangement Form or state permit schedules the Crematory Package preparation (2026-10); other uploads do not', async () => {
    const { runAfterResponse } = await import('@/lib/afterResponse');
    vi.mocked(runAfterResponse).mockClear();
    const formData = sampleFormData();
    formData.set('documentTypeKey', 'external_form.arrangement_forms');
    expect((await uploadRequest(formData)).status).toBe(201);
    expect((await permitUpload([7, 7, 7])).status).toBe(201);
    expect(vi.mocked(runAfterResponse).mock.calls.map(([label]) => label)).toEqual(['crematory package preparation', 'crematory package preparation']);

    vi.mocked(runAfterResponse).mockClear();
    expect((await uploadRequest(sampleFormData())).status).toBe(201);
    expect(runAfterResponse).not.toHaveBeenCalled();
  });

  it('a state permit is stored under the one-current-permit rules (2026-10): a duplicate or a second permit is refused; a replacement names the one it replaces', async () => {
    const first = await permitUpload([4, 4, 4]);
    expect(first.status).toBe(201);
    const { document } = await first.json();
    expect(document).toMatchObject({ documentTypeKey: 'cremation_form.state_permit', version: 1, status: 'active' });

    const duplicate = await permitUpload([4, 4, 4]);
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toContain("already this case's State Cremation Permit");
    const second = await permitUpload([5, 5, 5]);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toContain('Use Replace permit');
    expect(caseDocumentFixtures.filter((d) => d.caseId === PERMIT_CASE_ID)).toHaveLength(1);

    const replacement = await permitUpload([5, 5, 5], { replacesDocumentId: document.id });
    expect(replacement.status).toBe(201);
    expect((await replacement.json()).document).toMatchObject({ version: 2, supersedesId: document.id, status: 'active' });
    expect(caseDocumentFixtures.find((d) => d.id === document.id)!.status).toBe('superseded');
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual(expect.arrayContaining(['crematory.permit_added', 'crematory.permit_replaced']));
  });

  it('a role without document.upload (readOnly) is refused', async () => {
    const readOnlyUser = { id: 'mock-user-readonly-upload-test', email: 'readonly-upload@beacon.test', displayName: 'Read Only Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: readOnlyUser.id, role: 'readOnly', isActive: true });
    mockSession = { user: readOnlyUser };

    const response = await uploadRequest(sampleFormData());
    expect(response.status).toBe(403);

    mockMembershipFixtures.pop();
  });
});
