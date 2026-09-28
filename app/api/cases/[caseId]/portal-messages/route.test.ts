import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { portalMessageFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { notificationFixtures, notificationRecipientFixtures } from '@/services/__mocks__/notificationFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET, POST } = await import('./route');

const TEST_CASE_ID = 'case-portal-messages-route-test';

function listRequest(organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/portal-messages?${params.toString()}`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

function createRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/portal-messages`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: TEST_CASE_ID }),
  });
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  portalMessageFixtures.length = 0;
  portalAccessFixtures.length = 0;
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-888',
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
  portalMessageFixtures.length = 0;
  portalAccessFixtures.length = 0;
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  caseFixtures.length = caseFixtures.filter((c) => c.id !== TEST_CASE_ID).length;
});

describe('GET /api/cases/[caseId]/portal-messages', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await listRequest(null)).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await listRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('a role without portal.message (accounting) is refused', async () => {
    const accountingUser = { id: 'mock-user-accounting-msg-test', email: 'accounting-msg@beacon.test', displayName: 'Accounting Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: accountingUser.id, role: 'accounting', isActive: true } as never);
    mockSession = { user: accountingUser };

    expect((await listRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('lists messages for the case', async () => {
    // GET (listing) is unaffected by item #3's Family Portal capability
    // gate — only the mutating POST below is gated — so this seeds
    // directly via the fixture rather than through POST.
    portalMessageFixtures.push({
      id: 'message-list-test-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      senderType: 'staff',
      senderStaffIdentityId: mockDefaultUser.id,
      senderPortalUserId: null,
      senderPortalAccessId: null,
      senderRelationshipTypeAtSend: null,
      body: 'Hello family',
      attachmentDocumentId: null,
      readByStaffAt: '2026-09-01T00:00:00.000Z',
      readByFamilyAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const response = await listRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].body).toBe('Hello family');
  });
});

describe('POST /api/cases/[caseId]/portal-messages', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await createRequest({}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, body: 'Hello' });
    expect(response.status).toBe(401);
  });

  it('rejects an empty body', async () => {
    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, body: '   ' });
    expect(response.status).toBe(400);
  });

  it('a role without portal.message (accounting) is refused', async () => {
    const accountingUser = { id: 'mock-user-accounting-msg-test-2', email: 'accounting-msg-2@beacon.test', displayName: 'Accounting Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: accountingUser.id, role: 'accounting', isActive: true } as never);
    mockSession = { user: accountingUser };

    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, body: 'Hello' });
    expect(response.status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('sends a staff message, marks it read-by-staff, and notifies every active message.read-capable portal user', async () => {
    // DEFAULT_ORGANIZATION_ID (managed-cremations) has Family Portal
    // disabled as of item #3 (2026-09) — this test is about the generic
    // send/notify mechanics, so it runs against a second organization
    // where Family Portal remains enabled (existing behavior preserved).
    mockMembershipFixtures.push({ organizationId: SECOND_MOCK_ORGANIZATION_ID, userId: mockDefaultUser.id, role: 'administrator', isActive: true } as never);
    caseFixtures.push({ ...caseFixtures.find((c) => c.id === TEST_CASE_ID)!, organizationId: SECOND_MOCK_ORGANIZATION_ID });
    portalAccessFixtures.push({
      id: 'access-msg-1',
      portalUserId: 'portal-user-msg-1',
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      relationshipType: 'primary_next_of_kin',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const response = await createRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID, body: 'The service is scheduled for Friday.' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.message.senderType).toBe('staff');
    expect(body.message.readByStaffAt).not.toBeNull();

    const notification = notificationFixtures.find((n) => n.notificationType === 'family.message_received');
    expect(notification).toBeDefined();
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification!.id);
    expect(recipient?.identityId).toBe('portal-user-msg-1');
    mockMembershipFixtures.pop();
  });

  it('handwritten item #3 (2026-09): returns 403 for managed-cremations (Family Portal disabled), even for a fully-permissioned administrator', async () => {
    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, body: 'Hello' });
    expect(response.status).toBe(403);
  });
});
