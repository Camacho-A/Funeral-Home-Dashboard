import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { notificationFixtures, notificationRecipientFixtures, notificationDeliveryFixtures } from '@/services/__mocks__/notificationFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';

const mockRenderHtmlToPdf = vi.fn();
const mockUploadFile = vi.fn();
const mockDownloadFile = vi.fn();

vi.mock('@/lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: (...args: unknown[]) => mockRenderHtmlToPdf(...args) },
}));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: (...args: unknown[]) => mockUploadFile(...args),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
    deleteFile: vi.fn(),
  },
}));
vi.mock('@/lib/identityMessageSignatureNotifier', () => ({
  identityMessageSignatureNotifier: { notifyRequested: vi.fn(), notifyCompleted: vi.fn(), notifyDeclined: vi.fn(), notifyCancelled: vi.fn() },
}));

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { POST } = await import('./route');
const { createSignatureRequest } = await import('@/services/signatureService');
const { generate } = await import('@/services/documentService');
const { createTemplate } = await import('@/services/documentTemplatesService');

const TEST_CASE_ID = 'case-family-sig-complete-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-sig-complete-route-test-${idCounter}`;
}

function completeRequest(requestId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(
    new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/signature-requests/${requestId}/complete`, { method: 'POST', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ caseId: TEST_CASE_ID, requestId }) },
  );
}

let lengths: Record<string, number>;
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  vi.clearAllMocks();
  mockRenderHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockUploadFile.mockImplementation(async (key: string) => ({ storageKey: key }));
  mockDownloadFile.mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' });

  lengths = {
    users: portalUserFixtures.length,
    sessions: portalSessionFixtures.length,
    access: portalAccessFixtures.length,
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
    caseNumber: 'B2026-223',
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
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
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

async function seedAuthorizedSessionAndRequest(sessionEmail = 'family-sig-complete@example.com', requestSignerEmail = sessionEmail) {
  const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
  const { createPortalSession } = await import('@/services/portal/portalSessionService');
  const { portalUser } = await findOrCreatePortalUser(
    { email: sessionEmail, displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
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

  const ctx = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'staff-1', actorMembershipId: null, actorRoleKey: 'funeralDirector', correlationId: 'seed-corr' };
  const template = await createTemplate(
    { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Cremation Authorization', documentTypeKey: 'authorization.cremation', category: 'authorization', body: '<p>x</p>', idFactory },
    ctx,
    'mock',
  );
  const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx, 'mock');
  const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Pat Family', signerEmail: requestSignerEmail, signerRole: 'next_of_kin', idFactory }, ctx, 'mock');
  return request;
}

describe('POST /api/family/cases/[caseId]/signature-requests/[requestId]/complete', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await completeRequest('req-1', { signedName: 'Pat' }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no family session', async () => {
    expect((await completeRequest('req-1', { signedName: 'Pat' })).status).toBe(401);
  });

  it('rejects a missing signedName', async () => {
    await seedAuthorizedSessionAndRequest();
    const response = await completeRequest('anything', {});
    expect(response.status).toBe(400);
  });

  it('completes the signature and records portal.signature.completed', async () => {
    const request = await seedAuthorizedSessionAndRequest();
    const response = await completeRequest(request.id, { signedName: 'Pat Family' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.request.status).toBe('signed');
    expect(body.request).not.toHaveProperty('tokenHash');
    expect(body.request).not.toHaveProperty('signerEmail');
    expect(body.request).not.toHaveProperty('requestedBy');
    expect(activityEventFixtures.some((e) => e.eventType === 'portal.signature.completed')).toBe(true);
  });

  it('returns 404 for a request addressed to a different email than the signed-in portal user', async () => {
    const request = await seedAuthorizedSessionAndRequest('family-sig-complete@example.com', 'someone-else@example.com');
    const response = await completeRequest(request.id, { signedName: 'Pat Family' });
    expect(response.status).toBe(404);
  });
});
