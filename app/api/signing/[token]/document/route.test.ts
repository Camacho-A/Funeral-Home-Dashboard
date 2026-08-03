import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';

const mockNotifyRequested = vi.fn();
const mockDownloadFile = vi.fn();
vi.mock('@/lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: async () => Buffer.from('%PDF-1.4 fake') },
}));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string) => ({ storageKey: key }),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
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
const { createSignatureRequest } = await import('@/services/signatureService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `sig-public-doc-route-test-${idCounter}`;
}

function documentRequest(token: string) {
  return GET(new Request(`http://localhost/api/signing/${token}/document`), { params: Promise.resolve({ token }) });
}

const TEST_CASE_ID = 'case-sig-public-doc-route-test';
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

beforeEach(() => {
  idCounter = 0;
  vi.clearAllMocks();
  mockNotifyRequested.mockResolvedValue(undefined);
  mockDownloadFile.mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' });
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  signatureRecordFixtures.length = 0;
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-772',
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

describe('GET /api/signing/[token]/document', () => {
  it('streams the document bytes inline (not a forced download), never a raw storage URL', async () => {
    const { rawToken } = await seedActiveRequestAndToken();

    const response = await documentRequest(rawToken);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('inline');
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.toString()).toContain('%PDF');
  });

  it('returns 404 for an invalid token', async () => {
    const response = await documentRequest('not-a-real-token');
    expect(response.status).toBe(404);
  });
});
