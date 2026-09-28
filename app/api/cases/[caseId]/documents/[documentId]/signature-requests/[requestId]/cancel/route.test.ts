import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
// Handwritten item #4 (2026-09): DEFAULT_ORGANIZATION_ID (the real Manor's
// Cremation organization id, managed-cremations) now has Signature
// Requests disabled — seeding via createSignatureRequest is itself
// blocked for that organization, so this file's generic cancel mechanics
// run against a second organization instead. See the dedicated test below
// proving cancel remains available for Manors specifically (a request
// seeded directly via fixtures, simulating one issued before Signature
// Requests was disabled).
const TEST_ORGANIZATION_ID = SECOND_MOCK_ORGANIZATION_ID;
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
  return `sig-cancel-route-test-${idCounter}`;
}

function cancelRequest(caseId: string, documentId: string, requestId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${caseId}/documents/${documentId}/signature-requests/${requestId}/cancel`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId, documentId, requestId }),
  });
}

const TEST_CASE_ID = 'case-sig-cancel-route-test';
const SEED_CTX = { organizationId: TEST_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  signatureRecordFixtures.length = 0;
  // mockDefaultUser's only built-in membership is for the real Manors
  // organization (now Signature Requests-disabled) — grant it
  // administrator in this file's test organization too.
  mockMembershipFixtures.push({ organizationId: TEST_ORGANIZATION_ID, userId: mockDefaultUser.id, role: 'administrator', isActive: true } as never);
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: TEST_ORGANIZATION_ID,
    caseNumber: 'B2026-774',
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
    nextOfKinEmail: null,
    nextOfKinRelationship: null,
    nextOfKinRelationshipOther: null,
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
    tagNumber: null,
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    vaNotificationResponsibility: null,
    checklistState: {},
    fieldValues: {},
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
    pickupNote: null,
    returnMethod: 'undecided',
    shippingCarrier: null,
    shippingTrackingNumber: null,
    shippingDateShipped: null,
    shippingDeliveryStatus: null,
    shippingDeliveredAt: null,
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
  const index = mockMembershipFixtures.findIndex((m) => m.organizationId === TEST_ORGANIZATION_ID && m.userId === mockDefaultUser.id);
  if (index !== -1) mockMembershipFixtures.splice(index, 1);
});

async function seedActiveRequest() {
  const template = await createTemplate(
    { organizationId: TEST_ORGANIZATION_ID, name: 'Cremation Authorization', documentTypeKey: 'authorization.cremation', category: 'authorization', body: '<p>{{case.decedent.fullName}}</p>', idFactory },
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

describe('POST /api/cases/[caseId]/documents/[documentId]/signature-requests/[requestId]/cancel', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const { doc, request } = await seedActiveRequest();
    const response = await cancelRequest(TEST_CASE_ID, doc.id, request.id, {}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('a role without signature.cancel (arranger) is refused', async () => {
    const { doc, request } = await seedActiveRequest();
    const arrangerUser = { id: 'mock-user-arranger-cancel-test', email: 'arranger-cancel@beacon.test', displayName: 'Arranger Test User', source: 'mock' as const };
    // 'arranger' is a valid Phase 22 DefaultRoleKey passed through unchanged
    // by resolveRoleKeyAlias, but OrganizationMembership.role's own type is
    // still the narrower, pre-Phase-22 five-value OrganizationRole enum.
    mockMembershipFixtures.push({ organizationId: TEST_ORGANIZATION_ID, userId: arrangerUser.id, role: 'arranger', isActive: true } as never);
    mockSession = { user: arrangerUser };

    const response = await cancelRequest(TEST_CASE_ID, doc.id, request.id, { organizationId: TEST_ORGANIZATION_ID });
    expect(response.status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('cancels the request and records document.signature.cancelled', async () => {
    const { doc, request } = await seedActiveRequest();
    const response = await cancelRequest(TEST_CASE_ID, doc.id, request.id, { organizationId: TEST_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.cancelled')).toBe(true);
  });

  it('returns 422 when cancelling an already-terminal request', async () => {
    const { doc, request } = await seedActiveRequest();
    await cancelSignatureRequest(TEST_ORGANIZATION_ID, TEST_CASE_ID, request.id, SEED_CTX, 'mock');

    const response = await cancelRequest(TEST_CASE_ID, doc.id, request.id, { organizationId: TEST_ORGANIZATION_ID });
    expect(response.status).toBe(422);
  });

  it('returns 404 for a nonexistent request', async () => {
    const { doc } = await seedActiveRequest();
    const response = await cancelRequest(TEST_CASE_ID, doc.id, 'no-such-request', { organizationId: TEST_ORGANIZATION_ID });
    expect(response.status).toBe(404);
  });

  it('handwritten item #4 (2026-09): cancel remains available for managed-cremations (Signature Requests disabled) — cancel only terminates, never creates/reissues', async () => {
    // Seeded directly via fixtures, not createSignatureRequest (which is
    // itself blocked for this organization) — simulates a request already
    // issued before Signature Requests was disabled for Manors.
    caseDocumentFixtures.push({
      id: 'doc-manors-cancel-test',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'case-manors-cancel-test',
      origin: 'uploaded',
      documentTypeKey: null,
      category: 'authorization',
      fileName: 'Uploaded.pdf',
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
      generatedBy: null,
      uploadedBy: 'staff-1',
      createdAt: '2026-09-01T00:00:00.000Z',
      correlationId: 'corr-manors-cancel-test',
    });
    signatureRequestFixtures.push({
      id: 'sig-request-manors-cancel-test',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'case-manors-cancel-test',
      documentId: 'doc-manors-cancel-test',
      documentVersion: 1,
      signerName: 'JANE DOE',
      signerEmail: 'jane@example.com',
      signerRole: 'next_of_kin',
      status: 'pending',
      tokenHash: 'a'.repeat(64),
      issuedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      requestVersion: 1,
      sequenceOrder: 1,
      requestedBy: 'staff-1',
      viewedAt: null,
      signedAt: null,
      declinedAt: null,
      declineReason: null,
      cancelledAt: null,
      cancelledBy: null,
      lastRemindedAt: null,
      reminderCount: 0,
      correlationId: 'corr-manors-cancel-test',
    });

    const response = await cancelRequest('case-manors-cancel-test', 'doc-manors-cancel-test', 'sig-request-manors-cancel-test', { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    expect(signatureRequestFixtures.find((r) => r.id === 'sig-request-manors-cancel-test')?.status).toBe('cancelled');

    caseDocumentFixtures.length = caseDocumentFixtures.filter((d) => d.id !== 'doc-manors-cancel-test').length;
    signatureRequestFixtures.length = signatureRequestFixtures.filter((r) => r.id !== 'sig-request-manors-cancel-test').length;
  });
});
