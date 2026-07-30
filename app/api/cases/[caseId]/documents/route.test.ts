import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string) => ({ storageKey: key }),
    downloadFile: async () => ({ buffer: Buffer.from('fake'), contentType: 'application/pdf' }),
    deleteFile: async () => undefined,
  },
}));

const { GET } = await import('./route');
const { upload } = await import('@/services/documentService');

function requestFor(caseId: string, organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/cases/${caseId}/documents?${params.toString()}`), { params: Promise.resolve({ caseId }) });
}

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `case-documents-route-test-${idCounter}`;
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
});

describe('GET /api/cases/[caseId]/documents', () => {
  it('returns 400 when organizationId is missing', async () => {
    expect((await requestFor('case-1', null)).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await requestFor('case-1', DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId the session has no membership in', async () => {
    expect((await requestFor('case-1', SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('lists only this case\'s documents, never another case\'s in the same organization', async () => {
    const ctx = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' };
    await upload({ caseId: 'case-1', fileName: 'a.pdf', mimeType: 'application/pdf', idFactory }, Buffer.from('a'), ctx, 'mock');
    await upload({ caseId: 'case-2', fileName: 'b.pdf', mimeType: 'application/pdf', idFactory }, Buffer.from('b'), ctx, 'mock');

    const response = await requestFor('case-1', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].caseId).toBe('case-1');
  });

  it('never returns another organization\'s documents, even for the same caseId', async () => {
    mockSession = { user: mockMultiOrgUser };
    await upload(
      { caseId: 'shared-case-id', fileName: 'a.pdf', mimeType: 'application/pdf', idFactory },
      Buffer.from('a'),
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: mockMultiOrgUser.id, actorMembershipId: null, actorRoleKey: 'officeStaff', correlationId: 'corr-1' },
      'mock',
    );
    await upload(
      { caseId: 'shared-case-id', fileName: 'b.pdf', mimeType: 'application/pdf', idFactory },
      Buffer.from('b'),
      { organizationId: SECOND_MOCK_ORGANIZATION_ID, actorIdentityId: mockMultiOrgUser.id, actorMembershipId: null, actorRoleKey: 'funeralDirector', correlationId: 'corr-2' },
      'mock',
    );

    const response = await requestFor('shared-case-id', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });
});
