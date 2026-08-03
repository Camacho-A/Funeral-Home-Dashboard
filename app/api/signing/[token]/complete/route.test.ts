import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';

const mockNotifyRequested = vi.fn();
const mockNotifyCompleted = vi.fn();
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
    notifyRequested: (...args: unknown[]) => mockNotifyRequested(...args),
    notifyCompleted: (...args: unknown[]) => mockNotifyCompleted(...args),
    notifyDeclined: async () => undefined,
    notifyCancelled: async () => undefined,
  },
}));

const { POST } = await import('./route');
const { createTemplate } = await import('@/services/documentTemplatesService');
const { generate } = await import('@/services/documentService');
const { createSignatureRequest } = await import('@/services/signatureService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `sig-public-complete-route-test-${idCounter}`;
}

function completeRequest(token: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/signing/${token}/complete`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ token }) });
}

const TEST_CASE_ID = 'case-sig-public-complete-route-test';
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

beforeEach(() => {
  idCounter = 0;
  vi.clearAllMocks();
  mockNotifyRequested.mockResolvedValue(undefined);
  mockNotifyCompleted.mockResolvedValue(undefined);
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  signatureRecordFixtures.length = 0;
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-771',
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

async function seedActiveRequestAndToken() {
  const template = await createTemplate(
    { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Cremation Authorization', documentTypeKey: 'authorization.cremation', category: 'authorization', body: '<p>{{case.decedent.fullName}}</p>', idFactory },
    SEED_CTX,
    'mock',
  );
  const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, SEED_CTX, 'mock');
  await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, SEED_CTX, 'mock');
  const rawToken = mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1];
  return { doc, rawToken };
}

describe('POST /api/signing/[token]/complete', () => {
  it('rejects a cross-site request (CSRF), despite there being no session to protect', async () => {
    const { rawToken } = await seedActiveRequestAndToken();
    const response = await completeRequest(rawToken, {}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('requires signedName', async () => {
    const { rawToken } = await seedActiveRequestAndToken();
    const response = await completeRequest(rawToken, { consentAcknowledged: true });
    expect(response.status).toBe(400);
  });

  it('requires consentAcknowledged to be exactly true', async () => {
    const { rawToken } = await seedActiveRequestAndToken();
    const response = await completeRequest(rawToken, { signedName: 'Jane Doe', consentAcknowledged: false });
    expect(response.status).toBe(400);
  });

  it('completes the signature, locking the document, with no Beacon session required', async () => {
    const { doc, rawToken } = await seedActiveRequestAndToken();

    const response = await completeRequest(rawToken, { signedName: 'Jane Doe', initials: 'JD', consentAcknowledged: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('signed');
    expect(mockNotifyCompleted).toHaveBeenCalledTimes(1);

    const reloaded = caseDocumentFixtures.find((d) => d.id === doc.id);
    expect(reloaded?.signatureStatus).toBe('signed');
  });

  it('returns 422 when replaying an already-completed request, regardless of the token still hashing correctly', async () => {
    const { rawToken } = await seedActiveRequestAndToken();
    await completeRequest(rawToken, { signedName: 'Jane Doe', consentAcknowledged: true });

    const response = await completeRequest(rawToken, { signedName: 'Jane Doe', consentAcknowledged: true });
    expect(response.status).toBe(422);
  });

  it('returns 404 for an invalid token', async () => {
    const response = await completeRequest('not-a-real-token', { signedName: 'Jane Doe', consentAcknowledged: true });
    expect(response.status).toBe(404);
  });
});
