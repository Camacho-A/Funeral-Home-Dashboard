import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRenderHtmlToPdf = vi.fn();
const mockUploadFile = vi.fn();
const mockDownloadFile = vi.fn();
const mockDeleteFile = vi.fn();
const mockNotifyRequested = vi.fn();
const mockNotifyCompleted = vi.fn();
const mockNotifyDeclined = vi.fn();
const mockNotifyCancelled = vi.fn();

vi.mock('../lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: (...args: unknown[]) => mockRenderHtmlToPdf(...args) },
}));
vi.mock('../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: (...args: unknown[]) => mockUploadFile(...args),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
    deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
  },
}));
vi.mock('../lib/identityMessageSignatureNotifier', () => ({
  identityMessageSignatureNotifier: {
    notifyRequested: (...args: unknown[]) => mockNotifyRequested(...args),
    notifyCompleted: (...args: unknown[]) => mockNotifyCompleted(...args),
    notifyDeclined: (...args: unknown[]) => mockNotifyDeclined(...args),
    notifyCancelled: (...args: unknown[]) => mockNotifyCancelled(...args),
  },
}));

const {
  createSignatureRequest,
  resendSignatureRequest,
  cancelSignatureRequest,
  expireOverdueSignatureRequests,
  resolveSigningToken,
  getDocumentBytesForSigning,
  markSignatureViewed,
  completeSignatureRequest,
  declineSignatureRequest,
  listRequests,
  listRecords,
  getRequestById,
  SignatureServiceError,
} = await import('./signatureService');
const { generate } = await import('./documentService');
const { createTemplate } = await import('./documentTemplatesService');
const { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } = await import('./__mocks__/documentFixtures');
const { activityEventFixtures } = await import('./__mocks__/activityEventFixtures');
const { caseFixtures } = await import('./__mocks__/fixtures');
const { notificationFixtures, notificationRecipientFixtures, notificationDeliveryFixtures, notificationDeliveryAttemptFixtures } = await import('./__mocks__/notificationFixtures');
const { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');

type ActivityContext = {
  organizationId: string;
  actorIdentityId: string | null;
  actorMembershipId: string | null;
  actorRoleKey: string | null;
  correlationId: string;
};

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `sig-${idCounter}`;
}

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'manager',
    correlationId: 'corr-1',
    ...overrides,
  };
}

const TEST_CASE_ID = 'case-signature-service-test';

let lengths: { docs: number; templates: number; requests: number; records: number; events: number; cases: number };
beforeEach(() => {
  idCounter = 0;
  vi.clearAllMocks();
  mockRenderHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake pdf content'));
  mockUploadFile.mockImplementation(async (key: string) => ({ storageKey: key }));
  mockDownloadFile.mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 fake pdf content'), contentType: 'application/pdf' });
  mockNotifyRequested.mockResolvedValue(undefined);
  mockNotifyCompleted.mockResolvedValue(undefined);
  mockNotifyDeclined.mockResolvedValue(undefined);
  mockNotifyCancelled.mockResolvedValue(undefined);

  lengths = {
    docs: caseDocumentFixtures.length,
    templates: documentTemplateFixtures.length,
    requests: signatureRequestFixtures.length,
    records: signatureRecordFixtures.length,
    events: activityEventFixtures.length,
    cases: caseFixtures.length,
  };
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-998',
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
  caseDocumentFixtures.length = lengths.docs;
  documentTemplateFixtures.length = lengths.templates;
  signatureRequestFixtures.length = lengths.requests;
  signatureRecordFixtures.length = lengths.records;
  activityEventFixtures.length = lengths.events;
  caseFixtures.length = lengths.cases;
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
});

async function createSampleDocument() {
  const template = await createTemplate(
    {
      organizationId: DEFAULT_ORGANIZATION_ID,
      name: 'Cremation Authorization',
      documentTypeKey: 'authorization.cremation',
      category: 'authorization',
      body: '<p>Dear {{case.primaryContact.fullName}}, re: {{case.decedent.fullName}}.</p>',
      idFactory,
    },
    ctx(),
    'mock',
  );
  return generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');
}

describe('createSignatureRequest', () => {
  it('creates a request, dispatches the notification, and advances draft -> pending', async () => {
    const doc = await createSampleDocument();

    const request = await createSignatureRequest(
      { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory },
      ctx(),
      'mock',
    );

    expect(request.status).toBe('pending');
    expect(request.documentId).toBe(doc.id);
    expect(request.documentVersion).toBe(doc.version);
    expect(mockNotifyRequested).toHaveBeenCalledTimes(1);
    expect(mockNotifyRequested.mock.calls[0][0].to).toBe('jane@example.com');
    expect(mockNotifyRequested.mock.calls[0][0].signLink).toContain('/sign?token=');

    const eventTypes = activityEventFixtures.map((e) => e.eventType);
    expect(eventTypes).toContain('document.signature.requested');
    expect(eventTypes).toContain('document.signature.email.sent');
  });

  it('never persists the raw token — only its hash', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest(
      { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory },
      ctx(),
      'mock',
    );

    expect(request.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(request)).not.toContain(mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1]);
  });

  it('stays draft when the notification fails to dispatch', async () => {
    mockNotifyRequested.mockRejectedValue(new Error('no provider configured'));
    const doc = await createSampleDocument();

    const request = await createSignatureRequest(
      { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory },
      ctx(),
      'mock',
    );

    expect(request.status).toBe('draft');
    expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.email.sent')).toBe(false);
    expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.requested')).toBe(true);
  });

  it('applies a default 30-day expiration when none is given', async () => {
    const doc = await createSampleDocument();
    const before = Date.now();
    const request = await createSignatureRequest(
      { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory },
      ctx(),
      'mock',
    );
    const daysUntilExpiry = (new Date(request.expiresAt!).getTime() - before) / (1000 * 60 * 60 * 24);
    expect(daysUntilExpiry).toBeGreaterThan(29);
    expect(daysUntilExpiry).toBeLessThan(31);
  });

  it('respects an explicit expiration date when given', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest(
      { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', expiresAt: '2026-12-25T00:00:00.000Z', idFactory },
      ctx(),
      'mock',
    );
    expect(request.expiresAt).toBe('2026-12-25T00:00:00.000Z');
  });

  it('rejects a second active request for the same document', async () => {
    const doc = await createSampleDocument();
    await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');

    await expect(
      createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'John Smith', signerEmail: 'john@example.com', signerRole: 'primary_contact', idFactory }, ctx(), 'mock'),
    ).rejects.toThrow(/active signature request already exists/i);
  });

  it('rejects requesting a signature for a document that is already signed', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    const rawToken = mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1];
    await completeSignatureRequest(request, { signedName: 'Jane Doe', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0', idFactory }, 'mock');
    void rawToken;

    await expect(
      createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'John Smith', signerEmail: 'john@example.com', signerRole: 'primary_contact', idFactory }, ctx(), 'mock'),
    ).rejects.toThrow(/already been signed/i);
  });

  it('rejects requesting a signature for a non-existent document', async () => {
    await expect(
      createSignatureRequest({ caseId: TEST_CASE_ID, documentId: 'no-such-doc', signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock'),
    ).rejects.toThrow(SignatureServiceError);
  });
});

describe('resendSignatureRequest', () => {
  it('rotates the token, invalidating the previous one', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    const originalTokenHash = request.tokenHash;
    const originalRawToken = mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1];

    const resent = await resendSignatureRequest(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, ctx(), 'mock');

    expect(resent.tokenHash).not.toBe(originalTokenHash);
    expect(resent.status).toBe('pending');
    expect(resent.reminderCount).toBe(1);
    await expect(resolveSigningToken(originalRawToken, 'mock')).rejects.toThrow(SignatureServiceError);

    const newRawToken = mockNotifyRequested.mock.calls[1][0].signLink.split('token=')[1];
    const resolved = await resolveSigningToken(newRawToken, 'mock');
    expect(resolved.id).toBe(request.id);
  });

  it('rejects resending a terminal request', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    await cancelSignatureRequest(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, ctx(), 'mock');

    await expect(resendSignatureRequest(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, ctx(), 'mock')).rejects.toThrow(/can no longer be resent/i);
  });
});

describe('cancelSignatureRequest', () => {
  it('cancels an active request and notifies the signer', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');

    await cancelSignatureRequest(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, ctx(), 'mock');

    const reloaded = await getRequestById(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, 'mock');
    expect(reloaded?.status).toBe('cancelled');
    expect(reloaded?.cancelledBy).toBe('identity-1');
    expect(mockNotifyCancelled).toHaveBeenCalledTimes(1);
    expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.cancelled')).toBe(true);
  });

  it("a cancelled request's token no longer resolves to a completable state", async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    const rawToken = mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1];

    await cancelSignatureRequest(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, ctx(), 'mock');

    const resolved = await resolveSigningToken(rawToken, 'mock');
    expect(resolved.status).toBe('cancelled');
    await expect(completeSignatureRequest(resolved, { signedName: 'Jane Doe', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0', idFactory }, 'mock')).rejects.toThrow(SignatureServiceError);
  });

  it('rejects cancelling an already-terminal request', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    await cancelSignatureRequest(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, ctx(), 'mock');

    await expect(cancelSignatureRequest(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, ctx(), 'mock')).rejects.toThrow(/can no longer be cancelled/i);
  });
});

describe('resolveSigningToken', () => {
  it('resolves a valid token to its request', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    const rawToken = mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1];

    const resolved = await resolveSigningToken(rawToken, 'mock');
    expect(resolved.id).toBe(request.id);
  });

  it('rejects a garbage/wrong token with a generic, existence-hiding error', async () => {
    await expect(resolveSigningToken('not-a-real-token', 'mock')).rejects.toThrow(/invalid or has expired/i);
  });

  it('treats an overdue expiresAt as expired immediately, even if the stored status has not been reconciled', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest(
      { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', expiresAt: '2020-01-01T00:00:00.000Z', idFactory },
      ctx(),
      'mock',
    );
    const rawToken = mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1];
    void request;

    await expect(resolveSigningToken(rawToken, 'mock')).rejects.toThrow(/invalid or has expired/i);
  });
});

describe('markSignatureViewed', () => {
  it('transitions pending -> viewed on first access, and records every access', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');

    const firstView = await markSignatureViewed(request, 'mock');
    expect(firstView.status).toBe('viewed');
    expect(firstView.viewedAt).not.toBeNull();

    const secondView = await markSignatureViewed(firstView, 'mock');
    expect(secondView.status).toBe('viewed');
    expect(secondView.viewedAt).toBe(firstView.viewedAt);

    const viewedEvents = activityEventFixtures.filter((e) => e.eventType === 'document.signature.viewed');
    expect(viewedEvents).toHaveLength(2);
  });

  it('attributes the view to a system-generated (sessionless) actor, never a Beacon identity', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');

    await markSignatureViewed(request, 'mock');

    const viewedEvent = activityEventFixtures.find((e) => e.eventType === 'document.signature.viewed');
    expect(viewedEvent?.actorIdentityId).toBeNull();
    expect(viewedEvent?.isSystemGenerated).toBe(true);
  });
});

describe('completeSignatureRequest', () => {
  it('completes a signature: inserts an immutable record, locks the document, and notifies', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    const viewed = await markSignatureViewed(request, 'mock');

    const { request: signedRequest, record } = await completeSignatureRequest(
      viewed,
      { signedName: 'Jane Doe', initials: 'JD', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0', idFactory },
      'mock',
    );

    expect(signedRequest.status).toBe('signed');
    expect(record.signedName).toBe('Jane Doe');
    expect(record.initials).toBe('JD');
    expect(record.verificationStatus).toBe('verified');
    expect(record.documentChecksumSha256).toBe(doc.checksumSha256);

    const records = await listRecords(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, 'mock');
    expect(records).toHaveLength(1);

    expect(mockNotifyCompleted).toHaveBeenCalledTimes(1);
    expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.completed')).toBe(true);

    // Additive internal staff notification — never replacing the external
    // signer email above (mockNotifyCompleted still fired exactly once).
    const internalNotification = notificationFixtures.find((n) => n.notificationType === 'signature.completed' && n.entityId === signedRequest.id);
    expect(internalNotification).toBeDefined();
    expect(internalNotification?.body).toContain('B2026-998');
    const internalRecipient = notificationRecipientFixtures.find((r) => r.notificationId === internalNotification!.id);
    expect(internalRecipient?.identityId).toBe('identity-1'); // SignatureRequest.requestedBy, from ctx().actorIdentityId at creation
  });

  it('rejects completing an already-terminal request (replay protection), regardless of the token still hashing correctly', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    const rawToken = mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1];

    await completeSignatureRequest(request, { signedName: 'Jane Doe', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0', idFactory }, 'mock');

    // Replay: resolve the same still-valid token and try to sign again.
    const resolvedAgain = await resolveSigningToken(rawToken, 'mock');
    expect(resolvedAgain.status).toBe('signed');
    await expect(
      completeSignatureRequest(resolvedAgain, { signedName: 'Jane Doe', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0', idFactory }, 'mock'),
    ).rejects.toThrow(/can no longer be completed/i);

    // Never a second record for the same request.
    const records = await listRecords(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, 'mock');
    expect(records).toHaveLength(1);
  });

  it('refuses to complete a signature when the document checksum does not match (tamper detection)', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');

    mockDownloadFile.mockResolvedValueOnce({ buffer: Buffer.from('tampered bytes, not the real document'), contentType: 'application/pdf' });

    await expect(
      completeSignatureRequest(request, { signedName: 'Jane Doe', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0', idFactory }, 'mock'),
    ).rejects.toThrow(/integrity check failed/i);

    const records = await listRecords(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, 'mock');
    expect(records).toHaveLength(0);
    const reloaded = await getRequestById(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, 'mock');
    expect(reloaded?.status).toBe('pending');
  });

  it('permanently locks the document — a subsequent regeneration attempt is rejected', async () => {
    const doc = await createSampleDocument();
    const template = documentTemplateFixtures.find((t) => t.id === doc.templateId)!;
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    await completeSignatureRequest(request, { signedName: 'Jane Doe', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0', idFactory }, 'mock');

    await expect(
      generate({ caseId: TEST_CASE_ID, templateId: template.id, existingDocumentId: doc.id, idFactory }, ctx(), 'mock'),
    ).rejects.toThrow(/permanently locked/i);
  });
});

describe('declineSignatureRequest', () => {
  it('declines a request with a reason and notifies the signer', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');

    const declined = await declineSignatureRequest(request, { reason: 'Disagrees with terms', ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0' }, 'mock');

    expect(declined.status).toBe('declined');
    expect(declined.declineReason).toBe('Disagrees with terms');
    expect(mockNotifyDeclined).toHaveBeenCalledTimes(1);
    expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.declined')).toBe(true);

    // A decline never touches CaseDocument.signatureStatus or creates a SignatureRecord.
    const records = await listRecords(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, 'mock');
    expect(records).toHaveLength(0);
    expect(caseDocumentFixtures.find((d) => d.id === doc.id)?.signatureStatus).toBeNull();

    // Additive internal staff notification, alongside the external signer email above.
    const internalNotification = notificationFixtures.find((n) => n.notificationType === 'signature.declined' && n.entityId === declined.id);
    expect(internalNotification).toBeDefined();
    const internalRecipient = notificationRecipientFixtures.find((r) => r.notificationId === internalNotification!.id);
    expect(internalRecipient?.identityId).toBe('identity-1');
  });

  it('rejects declining an already-terminal request', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    await declineSignatureRequest(request, { ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0' }, 'mock');

    const reloaded = await getRequestById(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, 'mock');
    await expect(declineSignatureRequest(reloaded!, { ipAddress: '203.0.113.1', userAgent: 'Mozilla/5.0' }, 'mock')).rejects.toThrow(/can no longer be declined/i);
  });
});

describe('expireOverdueSignatureRequests', () => {
  it('flips an overdue pending/viewed request to expired and records the event', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest(
      { caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', expiresAt: '2020-01-01T00:00:00.000Z', idFactory },
      ctx(),
      'mock',
    );
    void request;

    const expiredCount = await expireOverdueSignatureRequests(DEFAULT_ORGANIZATION_ID, 'mock');

    expect(expiredCount).toBe(1);
    const reloaded = await getRequestById(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, 'mock');
    expect(reloaded?.status).toBe('expired');
    expect(activityEventFixtures.some((e) => e.eventType === 'document.signature.expired')).toBe(true);
  });

  it('never touches a request that is not yet overdue', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');

    const expiredCount = await expireOverdueSignatureRequests(DEFAULT_ORGANIZATION_ID, 'mock');

    expect(expiredCount).toBe(0);
    const reloaded = await getRequestById(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, request.id, 'mock');
    expect(reloaded?.status).toBe('pending');
  });
});

describe('cross-tenant isolation', () => {
  it('never returns/lists another organization\'s signature requests or records', async () => {
    const doc = await createSampleDocument();
    await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');

    const otherOrgRequests = await listRequests(SECOND_MOCK_ORGANIZATION_ID, TEST_CASE_ID, doc.id, 'mock');
    expect(otherOrgRequests).toHaveLength(0);
  });

  it('a token resolved for org A never resolves anything for org B', async () => {
    const doc = await createSampleDocument();
    await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');
    const rawToken = mockNotifyRequested.mock.calls[0][0].signLink.split('token=')[1];

    const resolved = await resolveSigningToken(rawToken, 'mock');
    expect(resolved.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(resolved.organizationId).not.toBe(SECOND_MOCK_ORGANIZATION_ID);
  });
});

describe('getDocumentBytesForSigning', () => {
  it('streams the document bytes for in-page review', async () => {
    const doc = await createSampleDocument();
    const request = await createSignatureRequest({ caseId: TEST_CASE_ID, documentId: doc.id, signerName: 'Jane Doe', signerEmail: 'jane@example.com', signerRole: 'next_of_kin', idFactory }, ctx(), 'mock');

    const result = await getDocumentBytesForSigning(request, 'mock');
    expect(result.buffer.toString()).toContain('%PDF');
    expect(result.fileName).toBe(doc.fileName);
  });
});

describe('SignatureService orchestration boundary (structural)', () => {
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

  function walk(dir: string, results: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath, results);
      } else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const root = join(__dirname, '..');
  const allFiles = walk(root);
  const signatureServicePath = join(__dirname, 'signatureService.ts');
  const documentServicePath = join(__dirname, 'documentService.ts');

  it('only signatureService.ts imports the concrete SignatureNotifier implementation', () => {
    const notifierImplPath = join(root, 'lib', 'identityMessageSignatureNotifier.ts');
    const importPattern = /^import .*from ['"][^'"]*identityMessageSignatureNotifier['"]/m;

    const offenders = allFiles.filter((filePath) => {
      if (filePath === signatureServicePath || filePath === notifierImplPath) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });

    expect(offenders).toEqual([]);
  });

  it('only signatureService.ts imports the recordSignature* activity helpers', () => {
    const signatureRecordHelpers = [
      'recordSignatureRequested',
      'recordSignatureEmailSent',
      'recordSignatureViewed',
      'recordSignatureCompleted',
      'recordSignatureDeclined',
      'recordSignatureCancelled',
      'recordSignatureExpired',
    ];
    const importPattern = new RegExp(`^import\\s*\\{[^}]*\\b(${signatureRecordHelpers.join('|')})\\b`, 'm');

    const offenders = allFiles.filter((filePath) => {
      if (filePath === signatureServicePath) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });

    expect(offenders).toEqual([]);
  });

  it('no route file imports lib/identity/tokens.ts directly for the signing flow', () => {
    const signingRoutesRoot = join(root, 'app', 'api', 'signing');
    if (!statSync(signingRoutesRoot, { throwIfNoEntry: false })) return;
    const routeFiles = walk(signingRoutesRoot);
    const importPattern = /^import .*from ['"][^'"]*identity\/tokens['"]/m;

    const offenders = routeFiles.filter((filePath) => importPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no file other than documentService.ts calls the actual signatureStatus mutator, applyCaseDocumentSignatureStatusToWixData', () => {
    // A narrower, more precise check than string-matching `signatureStatus: 'signed'`
    // anywhere — that phrase also appears legitimately in activityService.ts's
    // event payloads (describing what changed, never writing to the collection
    // itself). The real enforcement point is this one mutator function.
    const mapperPath = join(root, 'lib', 'wixCaseDocumentMapper.ts');
    const importPattern = /applyCaseDocumentSignatureStatusToWixData/;

    const offenders = allFiles.filter((filePath) => {
      if (filePath === documentServicePath || filePath === mapperPath) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });

    expect(offenders).toEqual([]);
  });
});
