import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { notificationFixtures, notificationRecipientFixtures, notificationDeliveryFixtures } from '@/services/__mocks__/notificationFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';

vi.mock('@/lib/puppeteerDocumentRenderer', () => ({ puppeteerDocumentRenderer: { renderHtmlToPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) } }));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: vi.fn().mockImplementation(async (key: string) => ({ storageKey: key })),
    downloadFile: vi.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' }),
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

const TEST_CASE_ID = 'case-family-sig-decline-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-sig-decline-route-test-${idCounter}`;
}

function declineRequest(requestId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(
    new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/signature-requests/${requestId}/decline`, { method: 'POST', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ caseId: TEST_CASE_ID, requestId }) },
  );
}

let lengths: Record<string, number>;
beforeEach(() => {
  idCounter = 0;
  familySession = null;
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
    caseNumber: 'B2026-224',
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

describe('POST /api/family/cases/[caseId]/signature-requests/[requestId]/decline', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    expect((await declineRequest('req-1', {}, { origin: 'http://evil.test', host: 'localhost' })).status).toBe(403);
  });

  it('returns 401 with no family session', async () => {
    expect((await declineRequest('req-1', {})).status).toBe(401);
  });

  it('declines the signature request', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-decline@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
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
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Pat Family', signerEmail: 'family-decline@example.com', signerRole: 'next_of_kin', idFactory }, ctx, 'mock');

    const response = await declineRequest(request.id, { reason: 'Need more time' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.request.status).toBe('declined');
    expect(body.request).not.toHaveProperty('tokenHash');
    expect(body.request).not.toHaveProperty('signerEmail');
    expect(body.request).not.toHaveProperty('requestedBy');
  });
});
