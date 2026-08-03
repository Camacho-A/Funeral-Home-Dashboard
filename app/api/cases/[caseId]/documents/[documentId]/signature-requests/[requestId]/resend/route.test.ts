import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
vi.mock('@/lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: async () => Buffer.from('%PDF-1.4 fake') },
}));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string) => ({ storageKey: key }),
    downloadFile: async () => ({ buffer: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' }),
    deleteFile: async () => undefined,
  },
}));
vi.mock('@/lib/identityMessageSignatureNotifier', () => ({
  identityMessageSignatureNotifier: {
    notifyRequested: async () => undefined,
    notifyCompleted: async () => undefined,
    notifyDeclined: async () => undefined,
    notifyCancelled: async () => undefined,
  },
}));

const { POST } = await import('./route');
const { createTemplate } = await import('@/services/documentTemplatesService');
const { generate } = await import('@/services/documentService');
const { createSignatureRequest, cancelSignatureRequest } = await import('@/services/signatureService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `sig-resend-route-test-${idCounter}`;
}

function resendRequest(caseId: string, documentId: string, requestId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${caseId}/documents/${documentId}/signature-requests/${requestId}/resend`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId, documentId, requestId }),
  });
}

const TEST_CASE_ID = 'case-sig-resend-route-test';
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  signatureRecordFixtures.length = 0;
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-775',
    decedentName: 'Robert Ellison',
    dateOfBirth: '04/12/1951',
    dateOfDeath: '01/02/2026',
    timeOfDeath: '',
    placeOfDeath: '',
    weight: '178 lb',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: 'Margaret Ellison',
    nextOfKinPhone: '(555) 010-1234',
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    checklistState: {},
    fieldValues: {},
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    workflowTemplateId: 'wf-1',
    workflowTemplateVersion: 1,
    caseType: 'cremation',
    workflowSnapshot: null,
  });
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  signatureRecordFixtures.length = 0;
  activityEventFixtures.length = 0;
  caseFixtures.length = caseFixtures.filter((c) => c.id !== TEST_CASE_ID).length;
});

async function seedActiveRequest() {
  const template = await createTemplate(
    { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Cremation Authorization', documentTypeKey: 'authorization.cremation', category: 'authorization', body: '<p>{{case.decedent.fullName}}</p>', idFactory },
    SEED_CTX,
    'mock',
  );
  const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, SEED_CTX, 'mock');
  const request = await createSignatureRequest(
    { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory },
    SEED_CTX,
    'mock',
  );
  return { doc, request };
}

describe('POST /api/cases/[caseId]/documents/[documentId]/signature-requests/[requestId]/resend', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const { doc, request } = await seedActiveRequest();
    const response = await resendRequest(TEST_CASE_ID, doc.id, request.id, {}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('a role without signature.request (readOnly) is refused', async () => {
    const { doc, request } = await seedActiveRequest();
    const readOnlyUser = { id: 'mock-user-readonly-resend-test', email: 'readonly-resend@beacon.test', displayName: 'Read Only Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: readOnlyUser.id, role: 'readOnly', isActive: true });
    mockSession = { user: readOnlyUser };

    const response = await resendRequest(TEST_CASE_ID, doc.id, request.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('rotates the token and re-notifies the signer', async () => {
    const { doc, request } = await seedActiveRequest();
    const response = await resendRequest(TEST_CASE_ID, doc.id, request.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.request.tokenHash).not.toBe(request.tokenHash);
    expect(body.request.reminderCount).toBe(1);
  });

  it('returns 422 for a terminal request', async () => {
    const { doc, request } = await seedActiveRequest();
    await cancelSignatureRequest(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, SEED_CTX, 'mock');

    const response = await resendRequest(TEST_CASE_ID, doc.id, request.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(422);
  });

  it('returns 404 for a nonexistent request', async () => {
    const { doc } = await seedActiveRequest();
    const response = await resendRequest(TEST_CASE_ID, doc.id, 'no-such-request', { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(404);
  });
});
