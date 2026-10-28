import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockManagerUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
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
const { upload } = await import('@/services/documentService');

const TEST_CASE_ID = 'case-archive-route-test';

function archiveRequest(documentId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/documents/${documentId}/archive`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: TEST_CASE_ID, documentId }),
  });
}

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `case-documents-archive-route-test-${idCounter}`;
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
  activityEventFixtures.length = 0;
});

async function seedUploadedDocument(organizationId: string = DEFAULT_ORGANIZATION_ID) {
  return upload(
    { caseId: TEST_CASE_ID, fileName: 'scan.pdf', mimeType: 'application/pdf', idFactory },
    Buffer.from('raw bytes'),
    { organizationId, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' },
    'mock',
  );
}

describe('POST /api/cases/[caseId]/documents/[documentId]/archive', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await archiveRequest('doc-1', { organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('11: archives the document and records document.archived for an organization with archiving enabled (not Manors)', async () => {
    mockMembershipFixtures.push({ organizationId: SECOND_MOCK_ORGANIZATION_ID, userId: mockDefaultUser.id, role: 'administrator', isActive: true });
    try {
      const document = await seedUploadedDocument(SECOND_MOCK_ORGANIZATION_ID);
      const response = await archiveRequest(document.id, { organizationId: SECOND_MOCK_ORGANIZATION_ID });
      expect(response.status).toBe(200);
      expect(caseDocumentFixtures.find((d) => d.id === document.id)?.status).toBe('archived');
      expect(activityEventFixtures.at(-1)?.eventType).toBe('document.archived');
    } finally {
      mockMembershipFixtures.pop();
    }
  });

  it('Manors (2026-10): an administrator removes a document, with a reason', async () => {
    const document = await seedUploadedDocument(DEFAULT_ORGANIZATION_ID);
    const missing = await archiveRequest(document.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(missing.status).toBe(400);
    expect(caseDocumentFixtures.find((d) => d.id === document.id)?.status).toBe('active');

    const response = await archiveRequest(document.id, { organizationId: DEFAULT_ORGANIZATION_ID, reason: 'wrong_document', note: 'belongs to another case' });
    expect(response.status).toBe(200);
    expect(caseDocumentFixtures.find((d) => d.id === document.id)?.status).toBe('archived');
    expect(activityEventFixtures.at(-1)?.description).toBe('Document removed — Wrong document: belongs to another case');
  });

  it('Manors (2026-10): a Manager — who has document.archive — still cannot remove; administrators only', async () => {
    const document = await seedUploadedDocument(DEFAULT_ORGANIZATION_ID);
    mockSession = { user: mockManagerUser };
    const response = await archiveRequest(document.id, { organizationId: DEFAULT_ORGANIZATION_ID, reason: 'duplicate' });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('Only an administrator can remove a document.');
    expect(caseDocumentFixtures.find((d) => d.id === document.id)?.status).toBe('active');
  });

  it('a role without document.archive (officeStaff) is refused — before the organization capability is even considered', async () => {
    const document = await seedUploadedDocument();
    const officeStaffUser = { id: 'mock-user-officestaff-archive-test', email: 'officestaff-archive@beacon.test', displayName: 'Office Staff', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: officeStaffUser.id, role: 'staff', isActive: true });
    mockSession = { user: officeStaffUser };

    const response = await archiveRequest(document.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);

    mockMembershipFixtures.pop();
  });

  it('returns 404 for a document that does not exist, for an organization with archiving enabled', async () => {
    mockMembershipFixtures.push({ organizationId: SECOND_MOCK_ORGANIZATION_ID, userId: mockDefaultUser.id, role: 'administrator', isActive: true });
    try {
      const response = await archiveRequest('no-such-doc', { organizationId: SECOND_MOCK_ORGANIZATION_ID });
      expect(response.status).toBe(404);
    } finally {
      mockMembershipFixtures.pop();
    }
  });
});
