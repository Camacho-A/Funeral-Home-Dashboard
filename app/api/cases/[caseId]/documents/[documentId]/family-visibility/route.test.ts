import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';
import type { CaseDocument } from '@/types/caseDocument';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');

const TEST_CASE_ID = 'case-family-visibility-route-test';

function makeDocument(overrides: Partial<CaseDocument> = {}): CaseDocument {
  return {
    id: 'doc-visibility-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: TEST_CASE_ID,
    origin: 'generated',
    documentTypeKey: 'authorization.cremation',
    category: 'authorization',
    fileName: 'Cremation Authorization.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 100,
    checksumSha256: 'a'.repeat(64),
    storageKey: 'key',
    status: 'active',
    templateId: null,
    templateVersion: null,
    version: null,
    supersedesId: null,
    signatureStatus: null,
    familyVisible: false,
    generatedBy: 'identity-1',
    uploadedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function patchRequest(documentId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/documents/${documentId}/family-visibility`, { method: 'PATCH', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: TEST_CASE_ID, documentId }),
  });
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
});

describe('PATCH /api/cases/[caseId]/documents/[documentId]/family-visibility', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    caseDocumentFixtures.push(makeDocument());
    const response = await patchRequest('doc-visibility-1', { organizationId: DEFAULT_ORGANIZATION_ID, familyVisible: true }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    caseDocumentFixtures.push(makeDocument());
    mockSession = null;
    expect((await patchRequest('doc-visibility-1', { organizationId: DEFAULT_ORGANIZATION_ID, familyVisible: true })).status).toBe(401);
  });

  it('rejects a non-boolean familyVisible', async () => {
    caseDocumentFixtures.push(makeDocument());
    const response = await patchRequest('doc-visibility-1', { organizationId: DEFAULT_ORGANIZATION_ID, familyVisible: 'yes' });
    expect(response.status).toBe(400);
  });

  it('a role without portal.manage (funeralDirector) is refused', async () => {
    caseDocumentFixtures.push(makeDocument());
    const fdUser = { id: 'mock-user-fd-visibility-test', email: 'fd-visibility@beacon.test', displayName: 'FD Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: fdUser.id, role: 'funeralDirector', isActive: true } as never);
    mockSession = { user: fdUser };

    expect((await patchRequest('doc-visibility-1', { organizationId: DEFAULT_ORGANIZATION_ID, familyVisible: true })).status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('returns 404 for a nonexistent document', async () => {
    const response = await patchRequest('no-such-doc', { organizationId: DEFAULT_ORGANIZATION_ID, familyVisible: true });
    expect(response.status).toBe(404);
  });

  it('flips familyVisible to true, then back to false', async () => {
    caseDocumentFixtures.push(makeDocument());
    const first = await patchRequest('doc-visibility-1', { organizationId: DEFAULT_ORGANIZATION_ID, familyVisible: true });
    expect(first.status).toBe(200);
    expect((await first.json()).document.familyVisible).toBe(true);

    const second = await patchRequest('doc-visibility-1', { organizationId: DEFAULT_ORGANIZATION_ID, familyVisible: false });
    expect((await second.json()).document.familyVisible).toBe(false);
  });
});
