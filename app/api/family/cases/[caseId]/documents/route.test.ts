import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';
import type { CaseDocument } from '@/types/caseDocument';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { GET } = await import('./route');

const TEST_CASE_ID = 'case-family-documents-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-documents-route-test-${idCounter}`;
}

function getRequest() {
  return GET(new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/documents`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

function makeDocument(overrides: Partial<CaseDocument> = {}): CaseDocument {
  return {
    id: 'doc-family-1',
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
    familyVisible: true,
    generatedBy: 'identity-1',
    uploadedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    correlationId: 'corr-1',
    ...overrides,
  };
}

let lengths: { users: number; sessions: number; access: number; docs: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length, access: portalAccessFixtures.length, docs: caseDocumentFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  caseDocumentFixtures.length = lengths.docs;
});

describe('GET /api/family/cases/[caseId]/documents', () => {
  it('returns 401 with no family session', async () => {
    expect((await getRequest()).status).toBe(401);
  });

  it('returns only familyVisible+active documents for an authorized portal user', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-documents@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
    portalAccessFixtures.push({
      id: 'access-1',
      portalUserId: portalUser.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      relationshipType: 'primary_next_of_kin',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    caseDocumentFixtures.push(makeDocument(), makeDocument({ id: 'doc-hidden', familyVisible: false }));

    const response = await getRequest();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.documents.map((d: { id: string }) => d.id)).toEqual(['doc-family-1']);
    expect(body.documents[0]).not.toHaveProperty('storageKey');
  });
});
