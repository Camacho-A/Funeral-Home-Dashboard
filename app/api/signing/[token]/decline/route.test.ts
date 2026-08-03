import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';

const mockNotifyRequested = vi.fn();
const mockNotifyDeclined = vi.fn();
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
    notifyDeclined: (...args: unknown[]) => mockNotifyDeclined(...args),
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
  return `sig-public-decline-route-test-${idCounter}`;
}

function declineRequest(token: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/signing/${token}/decline`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ token }) });
}

const TEST_CASE_ID = 'case-sig-public-decline-route-test';
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

beforeEach(() => {
  idCounter = 0;
  vi.clearAllMocks();
  mockNotifyRequested.mockResolvedValue(undefined);
  mockNotifyDeclined.mockResolvedValue(undefined);
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  signatureRecordFixtures.length = 0;
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-770',
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

describe('POST /api/signing/[token]/decline', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const { rawToken } = await seedActiveRequestAndToken();
    const response = await declineRequest(rawToken, {}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('declines with an optional reason and notifies the signer', async () => {
    const { rawToken } = await seedActiveRequestAndToken();
    const response = await declineRequest(rawToken, { reason: 'Disagrees with terms' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('declined');
    expect(mockNotifyDeclined).toHaveBeenCalledTimes(1);
    expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.declined')).toBe(true);
  });

  it('declines with no reason at all', async () => {
    const { rawToken } = await seedActiveRequestAndToken();
    const response = await declineRequest(rawToken, {});
    expect(response.status).toBe(200);
  });

  it('never touches CaseDocument.signatureStatus on decline', async () => {
    const { doc, rawToken } = await seedActiveRequestAndToken();
    await declineRequest(rawToken, {});
    const reloaded = caseDocumentFixtures.find((d) => d.id === doc.id);
    expect(reloaded?.signatureStatus).toBeNull();
  });

  it('returns 422 when replaying an already-declined request', async () => {
    const { rawToken } = await seedActiveRequestAndToken();
    await declineRequest(rawToken, {});

    const response = await declineRequest(rawToken, {});
    expect(response.status).toBe(422);
  });

  it('returns 404 for an invalid token', async () => {
    const response = await declineRequest('not-a-real-token', {});
    expect(response.status).toBe(404);
  });
});
