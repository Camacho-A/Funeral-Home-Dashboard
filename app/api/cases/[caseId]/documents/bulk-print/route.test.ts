// @vitest-environment node
//
// pdf-lib's internal validators do a strict `instanceof Uint8Array` check.
// This suite's global default test environment is jsdom (needed for React
// component tests elsewhere), whose own Uint8Array global is a distinct
// realm from Node's — a real Node Buffer (`instanceof Buffer` true) fails
// jsdom's `instanceof Uint8Array` check, which pdf-lib's PDFDocument.load
// relies on. This route is pure server-side Node code with no DOM
// dependency, so forcing the Node environment for this one file is both
// correct and sufficient — no other file's environment is affected.
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

/**
 * Task #3 (2026-09) — "Print All." Mirrors bulk-download's own test shape
 * for authorization/tenant isolation, plus PDF-composition-specific
 * coverage: a real, synthetic multi-page PDF built with pdf-lib (never a
 * real document) is uploaded, and the response is parsed back with
 * pdf-lib to confirm the combined page count — proving pages are
 * genuinely copied in, not merely concatenated bytes.
 */

async function makeSyntheticPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const storedBytesByKey = new Map<string, Buffer>();
const mockDownloadFile = vi.fn(async (storageKey: string) => {
  const buffer = storedBytesByKey.get(storageKey);
  if (!buffer) throw new Error('no such blob');
  return { buffer, contentType: 'application/pdf' };
});
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string, contents: Buffer) => {
      storedBytesByKey.set(key, contents);
      return { storageKey: key };
    },
    downloadFile: (storageKey: string) => mockDownloadFile(storageKey),
    deleteFile: async () => undefined,
  },
}));

const { GET } = await import('./route');
const { upload } = await import('@/services/documentService');

const TEST_CASE_ID = 'case-bulk-print-route-test';

function bulkPrintRequest(caseId: string, organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/cases/${caseId}/documents/bulk-print?${params.toString()}`), {
    params: Promise.resolve({ caseId }),
  });
}

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `bulk-print-route-test-${idCounter}`;
}

function seedCase(id: string, organizationId: string, caseNumberValue: string) {
  const base = { ...caseFixtures[0] };
  caseFixtures.push({ ...base, id, organizationId, caseNumber: caseNumberValue });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
  storedBytesByKey.clear();
  mockDownloadFile.mockClear();
  seedCase(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID, 'B2026-034');
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
  activityEventFixtures.length = 0;
  const index = caseFixtures.findIndex((c) => c.id === TEST_CASE_ID);
  if (index !== -1) caseFixtures.splice(index, 1);
});

async function seedPdfDocument(fileName: string, pageCount: number) {
  const bytes = await makeSyntheticPdf(pageCount);
  return upload(
    { caseId: TEST_CASE_ID, fileName, mimeType: 'application/pdf', idFactory },
    bytes,
    { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' },
    'mock',
  );
}

async function seedDocxDocument(fileName: string) {
  return upload(
    { caseId: TEST_CASE_ID, fileName, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', idFactory },
    Buffer.from('synthetic docx bytes'),
    { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' },
    'mock',
  );
}

describe('GET /api/cases/[caseId]/documents/bulk-print — authorization', () => {
  it('4. returns 400 when organizationId is missing', async () => {
    expect((await bulkPrintRequest(TEST_CASE_ID, null)).status).toBe(400);
  });

  it('4. returns 401 with no session', async () => {
    mockSession = null;
    expect((await bulkPrintRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('4. returns 403 for a forged organizationId the caller has no membership in', async () => {
    expect((await bulkPrintRequest(TEST_CASE_ID, 'org-with-no-membership')).status).toBe(403);
  });

  it('5. cross-tenant access is rejected', async () => {
    await seedPdfDocument('Statement.pdf', 1);
    const otherOrgUser = { id: 'mock-user-other-org-bulk-print', email: 'otherorg@beacon.test', displayName: 'Other Org', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: SECOND_MOCK_ORGANIZATION_ID, userId: otherOrgUser.id, role: 'administrator', isActive: true });
    mockSession = { user: otherOrgUser };

    const response = await bulkPrintRequest(TEST_CASE_ID, SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(404);

    mockMembershipFixtures.pop();
  });
});

describe('GET /api/cases/[caseId]/documents/bulk-print — combined PDF construction', () => {
  it('3. returns 404 (never a blank PDF) when there are no eligible documents', async () => {
    expect((await bulkPrintRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID)).status).toBe(404);
  });

  it('6/15/16/17. combines every eligible PDF\'s real pages (never re-flattened) into one PDF, never altering the originals', async () => {
    const doc1 = await seedPdfDocument('Statement.pdf', 2);
    const doc2 = await seedPdfDocument('Death Certificate.pdf', 3);

    const response = await bulkPrintRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toContain('B2026-034-documents.pdf');

    const combinedBytes = Buffer.from(await response.arrayBuffer());
    const combined = await PDFDocument.load(combinedBytes);
    expect(combined.getPageCount()).toBe(5); // 2 + 3 — genuinely copied pages, not a fixed/faked count

    // Originals untouched — re-fetching each stored document's own bytes
    // (via the storage mock) still parses as the original page count.
    const original1 = await PDFDocument.load(storedBytesByKey.get(doc1.storageKey)!);
    expect(original1.getPageCount()).toBe(2);
    const original2 = await PDFDocument.load(storedBytesByKey.get(doc2.storageKey)!);
    expect(original2.getPageCount()).toBe(3);
  });

  it('17. no permanent CaseDocument is created by Print All', async () => {
    const { list } = await import('@/services/documentService');
    await seedPdfDocument('Statement.pdf', 1);
    const before = await list(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'mock');

    await bulkPrintRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);

    const after = await list(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'mock');
    expect(after.length).toBe(before.length);
  });

  it('a DOCX upload is excluded from the combined PDF with a clear reason, while an eligible PDF still succeeds', async () => {
    await seedPdfDocument('Statement.pdf', 1);
    await seedDocxDocument('Scan.docx');

    const response = await bulkPrintRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);

    const excluded = JSON.parse(decodeURIComponent(response.headers.get('X-Bulk-Excluded')!));
    expect(excluded).toEqual([
      { fileName: 'Scan.docx', reason: 'This file type cannot be included in the combined print — download it separately to print it.' },
    ]);

    const combined = await PDFDocument.load(Buffer.from(await response.arrayBuffer()));
    expect(combined.getPageCount()).toBe(1); // only Statement.pdf's page
  });

  it('embeds a JPEG upload as a full page image rather than skipping or crashing', async () => {
    // A minimal valid JPEG (1x1 red pixel, generated via Pillow) — fully
    // synthetic, never a real photo.
    const tinyJpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
      'base64',
    );
    await upload(
      { caseId: TEST_CASE_ID, fileName: 'Photo.jpg', mimeType: 'image/jpeg', idFactory },
      tinyJpeg,
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-jpg' },
      'mock',
    );

    const response = await bulkPrintRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const combined = await PDFDocument.load(Buffer.from(await response.arrayBuffer()));
    expect(combined.getPageCount()).toBe(1);
  });

  it('13/14. a broken/unavailable stored document is skipped without exposing storage details, and the rest still succeed', async () => {
    const doc1 = await seedPdfDocument('Statement.pdf', 1);
    // Seed a second document whose storage entry is deliberately never
    // written (simulating a stale/broken CaseDocument row).
    const doc2 = await upload(
      { caseId: TEST_CASE_ID, fileName: 'Broken.pdf', mimeType: 'application/pdf', idFactory },
      await makeSyntheticPdf(1),
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-2' },
      'mock',
    );
    storedBytesByKey.delete(doc2.storageKey);

    const response = await bulkPrintRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const excluded = JSON.parse(decodeURIComponent(response.headers.get('X-Bulk-Excluded')!));
    expect(excluded).toEqual([{ fileName: 'Broken.pdf', reason: 'Document storage is currently unavailable.' }]);
    expect(JSON.stringify(excluded)).not.toContain(doc2.storageKey);

    const combined = await PDFDocument.load(Buffer.from(await response.arrayBuffer()));
    expect(combined.getPageCount()).toBe(1); // only doc1's page
    void doc1;
  });
});
