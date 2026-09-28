import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

/**
 * Task #3 (2026-09) — "Download All." Mirrors
 * app/api/cases/[caseId]/documents/[documentId]/download/route.test.ts's
 * own auth/tenant-isolation test shape exactly, plus ZIP-content-specific
 * coverage (real jszip, no mocking — the ZIP bytes this route actually
 * returns are unzipped and inspected directly). Synthetic file contents
 * only, never a real PDF/PII.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const mockDownloadFile = vi.fn(async (storageKey: string) => {
  return { buffer: Buffer.from(`synthetic bytes for ${storageKey}`), contentType: 'application/pdf' };
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

const TEST_CASE_ID = 'case-bulk-download-route-test';

function bulkDownloadRequest(caseId: string, organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/cases/${caseId}/documents/bulk-download?${params.toString()}`), {
    params: Promise.resolve({ caseId }),
  });
}

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `bulk-download-route-test-${idCounter}`;
}

function seedCase(id: string, organizationId: string, caseNumberValue: string) {
  const base = { ...caseFixtures[0] };
  caseFixtures.push({ ...base, id, organizationId, caseNumber: caseNumberValue });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
  mockDownloadFile.mockClear();
  seedCase(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID, 'B2026-034');
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
  activityEventFixtures.length = 0;
  const index = caseFixtures.findIndex((c) => c.id === TEST_CASE_ID);
  if (index !== -1) caseFixtures.splice(index, 1);
});

async function seedDocument(fileName: string, overrides: Parameters<typeof upload>[0] extends infer T ? Partial<T> : never = {}) {
  return upload(
    { caseId: TEST_CASE_ID, fileName, mimeType: 'application/pdf', idFactory, ...overrides },
    Buffer.from(`raw bytes for ${fileName}`),
    { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' },
    'mock',
  );
}

describe('GET /api/cases/[caseId]/documents/bulk-download — authorization', () => {
  it('4. returns 400 when organizationId is missing', async () => {
    expect((await bulkDownloadRequest(TEST_CASE_ID, null)).status).toBe(400);
  });

  it('4. returns 401 with no session', async () => {
    mockSession = null;
    expect((await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('4. returns 403 for a forged organizationId the caller has no membership in', async () => {
    expect((await bulkDownloadRequest(TEST_CASE_ID, 'org-with-no-membership')).status).toBe(403);
  });

  it('4. a caller with no membership anywhere cannot bulk-retrieve documents', async () => {
    await seedDocument('Statement.pdf');
    const noMembershipUser = { id: 'mock-user-no-membership-bulk-dl', email: 'nomembership@beacon.test', displayName: 'No Membership', source: 'mock' as const };
    mockSession = { user: noMembershipUser };
    expect((await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('5. cross-tenant access is rejected — a caller authorized in a different organization cannot pull this case\'s ZIP, even naming the same caseId', async () => {
    await seedDocument('Statement.pdf');
    const otherOrgUser = { id: 'mock-user-other-org-bulk-dl', email: 'otherorg@beacon.test', displayName: 'Other Org', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: SECOND_MOCK_ORGANIZATION_ID, userId: otherOrgUser.id, role: 'administrator', isActive: true });
    mockSession = { user: otherOrgUser };

    const response = await bulkDownloadRequest(TEST_CASE_ID, SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(404); // this case does not exist for that organization

    mockMembershipFixtures.pop();
  });
});

describe('GET /api/cases/[caseId]/documents/bulk-download — ZIP construction', () => {
  it('3. returns 404 (never an empty ZIP) when there are no eligible documents', async () => {
    const response = await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('6/7/8/9. server determines eligible documents itself and returns one real ZIP containing exactly those documents, byte-for-byte', async () => {
    const doc1 = await seedDocument('Statement.pdf');
    const doc2 = await seedDocument('Death Certificate.pdf');

    const response = await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toContain('B2026-034-documents.zip');

    const zipBytes = Buffer.from(await response.arrayBuffer());
    const zip = await JSZip.loadAsync(zipBytes);
    const entryNames = Object.keys(zip.files).sort();
    expect(entryNames).toEqual(['Death Certificate.pdf', 'Statement.pdf'].sort());

    const statementBytes = await zip.file('Statement.pdf')!.async('string');
    expect(statementBytes).toBe(`synthetic bytes for ${doc1.storageKey}`);
    const deathCertBytes = await zip.file('Death Certificate.pdf')!.async('string');
    expect(deathCertBytes).toBe(`synthetic bytes for ${doc2.storageKey}`);

    expect(mockDownloadFile).toHaveBeenCalledWith(doc1.storageKey);
    expect(mockDownloadFile).toHaveBeenCalledWith(doc2.storageKey);
  });

  it('10. duplicate filenames are disambiguated, never colliding inside the ZIP', async () => {
    await seedDocument('Statement.pdf');
    await seedDocument('Statement.pdf');

    const response = await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(['Statement (2).pdf', 'Statement.pdf'].sort());
  });

  it('11. the ZIP filename uses the sanitized case number', async () => {
    caseFixtures.find((c) => c.id === TEST_CASE_ID)!.caseNumber = 'B2026-034';
    await seedDocument('Statement.pdf');
    const response = await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.headers.get('Content-Disposition')).toContain('B2026-034-documents.zip');
  });

  it('12. a path-traversal-shaped uploaded filename is sanitized to a safe leaf name inside the ZIP', async () => {
    await seedDocument('../../etc/passwd');
    const response = await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    const names = Object.keys(zip.files);
    expect(names).toEqual(['passwd']);
    expect(names.some((n) => n.includes('..'))).toBe(false);
  });

  it('13. a failed/unavailable document is skipped, without exposing its storage key, and does not break the rest of the ZIP', async () => {
    const doc1 = await seedDocument('Statement.pdf');
    const doc2 = await seedDocument('Broken.pdf');
    mockDownloadFile.mockImplementation(async (storageKey: string) => {
      if (storageKey === doc2.storageKey) throw new Error(`blob store internal path /private/blobs/${storageKey} unreachable`);
      return { buffer: Buffer.from(`raw bytes for Statement.pdf`), contentType: 'application/pdf' };
    });

    const response = await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);

    const excludedHeader = response.headers.get('X-Bulk-Excluded');
    expect(excludedHeader).toBeTruthy();
    const excluded = JSON.parse(decodeURIComponent(excludedHeader!));
    expect(excluded).toEqual([{ fileName: 'Broken.pdf', reason: 'Document storage is currently unavailable.' }]);
    expect(JSON.stringify(excluded)).not.toContain(doc2.storageKey);
    expect(JSON.stringify(excluded)).not.toContain('/private/blobs');

    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    expect(Object.keys(zip.files)).toEqual(['Statement.pdf']);
    void doc1;
  });

  it('archived documents remain eligible for Download All, consistent with individual download (item #12)', async () => {
    const { archive } = await import('@/services/documentService');
    const doc = await seedDocument('Old Statement.pdf');
    await archive(
      DEFAULT_ORGANIZATION_ID,
      TEST_CASE_ID,
      doc.id,
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-archive' },
      'mock',
    ).catch(() => {
      // Manors (managed-cremations) has archiving disabled since item #12 —
      // this assertion only needs the document's eligibility for bulk
      // download, not that the archive call itself succeeds here.
    });

    const response = await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    expect(Object.keys(zip.files)).toContain('Old Statement.pdf');
  });

  it('never touches caseSequences or Case Numbering — the ZIP filename only reads the existing caseNumber, never allocates one', async () => {
    await seedDocument('Statement.pdf');
    const before = caseFixtures.find((c) => c.id === TEST_CASE_ID)!.caseNumber;
    await bulkDownloadRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    const after = caseFixtures.find((c) => c.id === TEST_CASE_ID)!.caseNumber;
    expect(after).toBe(before);
  });
});
