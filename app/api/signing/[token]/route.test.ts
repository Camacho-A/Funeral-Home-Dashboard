import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';

const mockNotifyRequested = vi.fn();
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
    notifyCompleted: async () => undefined,
    notifyDeclined: async () => undefined,
    notifyCancelled: async () => undefined,
  },
}));

const { GET } = await import('./route');
const { createTemplate } = await import('@/services/documentTemplatesService');
const { generate } = await import('@/services/documentService');
const { createSignatureRequest, cancelSignatureRequest } = await import('@/services/signatureService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `sig-public-get-route-test-${idCounter}`;
}

function signingRequest(token: string) {
  return GET(new Request(`http://localhost/api/signing/${token}`), { params: Promise.resolve({ token }) });
}

const TEST_CASE_ID = 'case-sig-public-get-route-test';
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

beforeEach(() => {
  idCounter = 0;
  vi.clearAllMocks();
  mockNotifyRequested.mockResolvedValue(undefined);
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  signatureRecordFixtures.length = 0;
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-773',
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
  const request = await createSignatureRequest(
    { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory },
    SEED_CTX,
    'mock',
  );
  const rawToken = mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1];
  return { doc, request, rawToken };
}

describe('GET /api/signing/[token]', () => {
  it('resolves a valid token and marks the request viewed, never requiring a Beacon session', async () => {
    const { rawToken } = await seedActiveRequestAndToken();

    const response = await signingRequest(rawToken);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('viewed');
    expect(body.signerName).toBe('Jane Doe');
    expect(body.decedentName).toBe('Robert Ellison');
    expect(body.documentFileName).toContain('Cremation Authorization');
  });

  it('returns 404 for an invalid/garbage token, with a generic message', async () => {
    const response = await signingRequest('not-a-real-token');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatch(/invalid or has expired/i);
  });

  it('still resolves a cancelled request\'s token (so the page can show "this request was cancelled"), rather than a generic 404', async () => {
    const { request, rawToken } = await seedActiveRequestAndToken();
    await cancelSignatureRequest(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, SEED_CTX, 'mock');

    const response = await signingRequest(rawToken);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('cancelled');
  });

  it('never exposes an internal id (SignatureRequest.id) in the response body', async () => {
    const { request, rawToken } = await seedActiveRequestAndToken();
    const response = await signingRequest(rawToken);
    const bodyText = await response.text();
    expect(bodyText).not.toContain(request.id);
  });
});
