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

function uploadRequest(formData: FormData, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/documents/upload`, { method: 'POST', headers, body: formData }), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

function sampleFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('organizationId', overrides.organizationId ?? DEFAULT_ORGANIZATION_ID);
  formData.set('file', new File([new Uint8Array([1, 2, 3])], 'scan.pdf', { type: overrides.mimeType ?? 'application/pdf' }));
  return formData;
}

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

  it('a role without document.upload (readOnly) is refused', async () => {
    const readOnlyUser = { id: 'mock-user-readonly-upload-test', email: 'readonly-upload@beacon.test', displayName: 'Read Only Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: readOnlyUser.id, role: 'readOnly', isActive: true });
    mockSession = { user: readOnlyUser };

    const response = await uploadRequest(sampleFormData());
    expect(response.status).toBe(403);

    mockMembershipFixtures.pop();
  });
});
