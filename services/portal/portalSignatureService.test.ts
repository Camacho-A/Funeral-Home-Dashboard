import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRenderHtmlToPdf = vi.fn();
const mockUploadFile = vi.fn();
const mockDownloadFile = vi.fn();
const mockNotifyRequested = vi.fn();
const mockNotifyCompleted = vi.fn();
const mockNotifyDeclined = vi.fn();
const mockNotifyCancelled = vi.fn();

vi.mock('../../lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: (...args: unknown[]) => mockRenderHtmlToPdf(...args) },
}));
vi.mock('../../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: (...args: unknown[]) => mockUploadFile(...args),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
    deleteFile: vi.fn(),
  },
}));
vi.mock('../../lib/identityMessageSignatureNotifier', () => ({
  identityMessageSignatureNotifier: {
    notifyRequested: (...args: unknown[]) => mockNotifyRequested(...args),
    notifyCompleted: (...args: unknown[]) => mockNotifyCompleted(...args),
    notifyDeclined: (...args: unknown[]) => mockNotifyDeclined(...args),
    notifyCancelled: (...args: unknown[]) => mockNotifyCancelled(...args),
  },
}));

const { createSignatureRequest } = await import('../signatureService');
const { generate } = await import('../documentService');
const { createTemplate } = await import('../documentTemplatesService');
const { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } = await import('../__mocks__/documentFixtures');
const { activityEventFixtures } = await import('../__mocks__/activityEventFixtures');
const { caseFixtures } = await import('../__mocks__/fixtures');
const { notificationFixtures, notificationRecipientFixtures, notificationDeliveryFixtures } = await import('../__mocks__/notificationFixtures');
const { DEFAULT_ORGANIZATION_ID } = await import('../__mocks__/organizationIds');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `portal-signature-service-test-${idCounter}`;
}

function ctx() {
  return { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'staff-1', actorMembershipId: 'membership-1', actorRoleKey: 'funeralDirector', correlationId: 'seed-corr' };
}

const TEST_CASE_ID = 'case-portal-signature-service-test';

let lengths: { docs: number; templates: number; requests: number; records: number; events: number; cases: number; notifications: number; recipients: number; deliveries: number };
beforeEach(() => {
  idCounter = 0;
  vi.clearAllMocks();
  mockRenderHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockUploadFile.mockImplementation(async (key: string) => ({ storageKey: key }));
  mockDownloadFile.mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' });

  lengths = {
    docs: caseDocumentFixtures.length,
    templates: documentTemplateFixtures.length,
    requests: signatureRequestFixtures.length,
    records: signatureRecordFixtures.length,
    events: activityEventFixtures.length,
    cases: caseFixtures.length,
    notifications: notificationFixtures.length,
    recipients: notificationRecipientFixtures.length,
    deliveries: notificationDeliveryFixtures.length,
  };
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-333',
    decedentName: 'Test Decedent',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '01/01/2026',
    timeOfDeath: '',
    placeOfDeath: '',
    weight: '',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: '',
    nextOfKinPhone: '',
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
  caseDocumentFixtures.length = lengths.docs;
  documentTemplateFixtures.length = lengths.templates;
  signatureRequestFixtures.length = lengths.requests;
  signatureRecordFixtures.length = lengths.records;
  activityEventFixtures.length = lengths.events;
  caseFixtures.length = lengths.cases;
  notificationFixtures.length = lengths.notifications;
  notificationRecipientFixtures.length = lengths.recipients;
  notificationDeliveryFixtures.length = lengths.deliveries;
});

async function seedRequest(signerEmail = 'family@example.com') {
  const template = await createTemplate(
    { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Cremation Authorization', documentTypeKey: 'authorization.cremation', category: 'authorization', body: '<p>x</p>', idFactory },
    ctx(),
    'mock',
  );
  const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');
  const request = await createSignatureRequest(
    { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Pat Family', signerEmail, signerRole: 'next_of_kin', idFactory },
    ctx(),
    'mock',
  );
  return request;
}

describe('portalSignatureService', () => {
  describe('listFamilySignatureRequests', () => {
    it('returns only active requests addressed to this portal user\'s email', async () => {
      await seedRequest('family@example.com');
      await seedRequest('someone-else@example.com');

      const { listFamilySignatureRequests } = await import('./portalSignatureService');
      const list = await listFamilySignatureRequests(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'family@example.com', 'mock');
      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty('signerEmail');
    });

    it('email matching is case-insensitive', async () => {
      await seedRequest('Family@Example.com');
      const { listFamilySignatureRequests } = await import('./portalSignatureService');
      const list = await listFamilySignatureRequests(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'family@example.com', 'mock');
      expect(list).toHaveLength(1);
    });
  });

  describe('completeFamilySignature', () => {
    it('completes the signature and records portal.signature.completed with real portalUserId', async () => {
      const request = await seedRequest('family@example.com');
      const { completeFamilySignature } = await import('./portalSignatureService');

      const result = await completeFamilySignature(
        { organizationId: DEFAULT_ORGANIZATION_ID, caseId: TEST_CASE_ID, requestId: request.id, portalUserId: 'portal-user-1', portalUserEmail: 'family@example.com', signedName: 'Pat Family', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0', idFactory },
        'mock',
      );

      expect(result.status).toBe('signed');
      const portalEvent = activityEventFixtures.find((e) => e.eventType === 'portal.signature.completed');
      expect(portalEvent).toBeDefined();
      expect(JSON.parse(portalEvent!.metadata!)).toMatchObject({ portalUserId: 'portal-user-1' });

      // The underlying document.signature.completed event still fires too.
      expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.completed')).toBe(true);
    });

    it('refuses to complete a request addressed to a different email — existence-hiding', async () => {
      const request = await seedRequest('someone-else@example.com');
      const { completeFamilySignature, PortalSignatureServiceError } = await import('./portalSignatureService');

      await expect(
        completeFamilySignature(
          { organizationId: DEFAULT_ORGANIZATION_ID, caseId: TEST_CASE_ID, requestId: request.id, portalUserId: 'portal-user-1', portalUserEmail: 'family@example.com', signedName: 'Pat Family', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0', idFactory },
          'mock',
        ),
      ).rejects.toThrow(PortalSignatureServiceError);
    });
  });

  describe('declineFamilySignature', () => {
    it('declines the request', async () => {
      const request = await seedRequest('family@example.com');
      const { declineFamilySignature } = await import('./portalSignatureService');

      const result = await declineFamilySignature(
        { organizationId: DEFAULT_ORGANIZATION_ID, caseId: TEST_CASE_ID, requestId: request.id, portalUserEmail: 'family@example.com', reason: 'Need more time', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0' },
        'mock',
      );
      expect(result.status).toBe('declined');
    });
  });
});
