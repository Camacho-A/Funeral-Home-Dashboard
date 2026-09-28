import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
// Handwritten item #4 (2026-09): DEFAULT_ORGANIZATION_ID (the real Manor's
// Cremation organization id, managed-cremations) now has Signature
// Requests disabled — this file's create/list mechanics are generic, so
// they run against a second organization instead.
const TEST_ORGANIZATION_ID = SECOND_MOCK_ORGANIZATION_ID;
import { mockDefaultUser, mockMultiOrgUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
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
    downloadFile: async () => ({ buffer: Buffer.from('%PDF-1.4 fake') , contentType: 'application/pdf' }),
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

const { GET, POST } = await import('./route');
const { createTemplate } = await import('@/services/documentTemplatesService');
const { generate } = await import('@/services/documentService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `sig-requests-route-test-${idCounter}`;
}

function listRequest(caseId: string, documentId: string, organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/cases/${caseId}/documents/${documentId}/signature-requests?${params.toString()}`), {
    params: Promise.resolve({ caseId, documentId }),
  });
}

function createRequest(caseId: string, documentId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${caseId}/documents/${documentId}/signature-requests`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId, documentId }),
  });
}

const TEST_CASE_ID = 'case-sig-requests-route-test';

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
    caseNumber: 'B2026-776',
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

async function seedDocument() {
  const template = await createTemplate(
    { organizationId: TEST_ORGANIZATION_ID, name: 'Cremation Authorization', documentTypeKey: 'authorization.cremation', category: 'authorization', body: '<p>{{case.decedent.fullName}}</p>', idFactory },
    { organizationId: TEST_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' },
    'mock',
  );
  return generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, { organizationId: TEST_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' }, 'mock');
}

describe('GET /api/cases/[caseId]/documents/[documentId]/signature-requests', () => {
  it('returns 400 with no organizationId', async () => {
    const doc = await seedDocument();
    expect((await listRequest(TEST_CASE_ID, doc.id, null)).status).toBe(400);
  });

  it('a role without signature.read (accounting) is refused', async () => {
    const doc = await seedDocument();
    const accountingUser = { id: 'mock-user-accounting-sig-test', email: 'accounting-sig@beacon.test', displayName: 'Accounting Test User', source: 'mock' as const };
    // 'accounting' is a valid Phase 22 DefaultRoleKey (passed through
    // unchanged by resolveRoleKeyAlias — see domain/rbac/legacyRoleAliases.ts),
    // but OrganizationMembership.role's own type is still the narrower,
    // pre-Phase-22 five-value OrganizationRole enum — this cast is the same
    // shape every route test testing a non-legacy role tier needs.
    mockMembershipFixtures.push({ organizationId: TEST_ORGANIZATION_ID, userId: accountingUser.id, role: 'accounting', isActive: true } as never);
    mockSession = { user: accountingUser };

    expect((await listRequest(TEST_CASE_ID, doc.id, TEST_ORGANIZATION_ID)).status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('lists requests and records for the document', async () => {
    const doc = await seedDocument();
    await createRequest(TEST_CASE_ID, doc.id, { organizationId: TEST_ORGANIZATION_ID, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin' });

    const response = await listRequest(TEST_CASE_ID, doc.id, TEST_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.requests).toHaveLength(1);
    expect(body.records).toHaveLength(0);
  });
});

describe('POST /api/cases/[caseId]/documents/[documentId]/signature-requests', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const doc = await seedDocument();
    const response = await createRequest(TEST_CASE_ID, doc.id, {}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    const doc = await seedDocument();
    const response = await createRequest(TEST_CASE_ID, doc.id, { organizationId: TEST_ORGANIZATION_ID, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin' });
    expect(response.status).toBe(401);
  });

  it('a role without signature.request (readOnly) is refused', async () => {
    const doc = await seedDocument();
    const readOnlyUser = { id: 'mock-user-readonly-sig-test', email: 'readonly-sig@beacon.test', displayName: 'Read Only Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: TEST_ORGANIZATION_ID, userId: readOnlyUser.id, role: 'readOnly', isActive: true });
    mockSession = { user: readOnlyUser };

    const response = await createRequest(TEST_CASE_ID, doc.id, { organizationId: TEST_ORGANIZATION_ID, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin' });
    expect(response.status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('returns 403 for a forged organizationId the caller has no membership in', async () => {
    const doc = await seedDocument();
    mockSession = { user: mockMultiOrgUser };
    const response = await createRequest(TEST_CASE_ID, doc.id, { organizationId: 'org-with-no-membership', signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin' });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid signerRole', async () => {
    const doc = await seedDocument();
    const response = await createRequest(TEST_CASE_ID, doc.id, { organizationId: TEST_ORGANIZATION_ID, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'bogus' });
    expect(response.status).toBe(400);
  });

  it('creates a signature request and records document.signature.requested', async () => {
    const doc = await seedDocument();
    const response = await createRequest(TEST_CASE_ID, doc.id, { organizationId: TEST_ORGANIZATION_ID, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.request.status).toBe('pending');
    expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.requested')).toBe(true);
  });

  it('returns 404 for a nonexistent document', async () => {
    const response = await createRequest(TEST_CASE_ID, 'no-such-doc', { organizationId: TEST_ORGANIZATION_ID, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin' });
    expect(response.status).toBe(404);
  });

  it('returns 422 when an active request already exists for the document', async () => {
    const doc = await seedDocument();
    await createRequest(TEST_CASE_ID, doc.id, { organizationId: TEST_ORGANIZATION_ID, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin' });

    const response = await createRequest(TEST_CASE_ID, doc.id, { organizationId: TEST_ORGANIZATION_ID, signerName: 'John Smith', signerEmail: 'john@example.com', signerRole: 'primary_contact' });
    expect(response.status).toBe(422);
  });

  it('handwritten item #4 (2026-09): returns 422 for managed-cremations (Signature Requests disabled), even for a fully-permissioned administrator, and creates no request', async () => {
    caseFixtures.push({ ...caseFixtures.find((c) => c.id === TEST_CASE_ID)!, id: 'case-manors-sig-test', organizationId: DEFAULT_ORGANIZATION_ID });
    caseDocumentFixtures.push({
      id: 'doc-manors-sig-test',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'case-manors-sig-test',
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
      correlationId: 'corr-manors-sig-test',
    });

    const response = await createRequest('case-manors-sig-test', 'doc-manors-sig-test', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      signerName: 'Jane Doe',
      signerEmail: 'jane@example.com',
      signerRole: 'next_of_kin',
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).not.toMatch(/wix|override|implementation/i);
    expect(signatureRequestFixtures.some((r) => r.documentId === 'doc-manors-sig-test')).toBe(false);

    caseFixtures.length = caseFixtures.filter((c) => c.id !== 'case-manors-sig-test').length;
    caseDocumentFixtures.length = caseDocumentFixtures.filter((d) => d.id !== 'doc-manors-sig-test').length;
  });
});
