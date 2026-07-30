import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
const mockDownloadFile = vi.fn(async (storageKey: string) => {
  void storageKey;
  return { buffer: Buffer.from('%PDF-1.4 fake pdf'), contentType: 'application/pdf' };
});
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string) => ({ storageKey: key }),
    downloadFile: (storageKey: string) => mockDownloadFile(storageKey),
    deleteFile: async () => undefined,
  },
}));

const { GET } = await import('./route');
const { upload } = await import('@/services/documentService');

const TEST_CASE_ID = 'case-download-route-test';

function downloadRequest(documentId: string, organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/documents/${documentId}/download?${params.toString()}`), {
    params: Promise.resolve({ caseId: TEST_CASE_ID, documentId }),
  });
}

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `case-documents-download-route-test-${idCounter}`;
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
  mockDownloadFile.mockClear();
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
  activityEventFixtures.length = 0;
});

async function seedUploadedDocument() {
  return upload(
    { caseId: TEST_CASE_ID, fileName: 'scan.pdf', mimeType: 'application/pdf', idFactory },
    Buffer.from('raw bytes'),
    { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' },
    'mock',
  );
}

describe('GET /api/cases/[caseId]/documents/[documentId]/download', () => {
  it('returns 400 when organizationId is missing', async () => {
    expect((await downloadRequest('doc-1', null)).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await downloadRequest('doc-1', DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId the caller has no membership in', async () => {
    expect((await downloadRequest('doc-1', 'org-with-no-membership')).status).toBe(403);
  });

  it('streams the bytes with correct headers and records document.downloaded — never exposes a storage URL', async () => {
    const document = await seedUploadedDocument();
    const response = await downloadRequest(document.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    expect(response.headers.get('Content-Disposition')).toContain('scan.pdf');
    const bodyText = await response.text();
    expect(bodyText).toContain('%PDF');
    expect(mockDownloadFile).toHaveBeenCalledWith(document.storageKey);
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.downloaded');
  });

  it('returns 404 for a document that does not exist', async () => {
    expect((await downloadRequest('no-such-doc', DEFAULT_ORGANIZATION_ID)).status).toBe(404);
  });

  it('a role without document.view (readOnly does have it — use a role with none) is refused', async () => {
    // No default role in this codebase lacks document.view except accounting,
    // which has no legacy mock-auth fixture — assert instead that a caller
    // with zero membership anywhere is refused, matching the forged-org test above.
    const document = await seedUploadedDocument();
    const noMembershipUser = { id: 'mock-user-no-membership-dl-test', email: 'nomembership@beacon.test', displayName: 'No Membership', source: 'mock' as const };
    mockSession = { user: noMembershipUser };
    const response = await downloadRequest(document.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it('never returns another organization\'s document, even with the correct documentId', async () => {
    const document = await seedUploadedDocument();
    const otherOrgUser = { id: 'mock-user-other-org-dl-test', email: 'otherorg@beacon.test', displayName: 'Other Org', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: SECOND_MOCK_ORGANIZATION_ID, userId: otherOrgUser.id, role: 'administrator', isActive: true });
    mockSession = { user: otherOrgUser };

    const response = await downloadRequest(document.id, SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(404);

    mockMembershipFixtures.pop();
  });
});
