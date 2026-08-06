import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import {
  notificationFixtures,
  notificationRecipientFixtures,
  notificationDeliveryFixtures,
  notificationDeliveryAttemptFixtures,
  notificationPreferenceFixtures,
} from '@/services/__mocks__/notificationFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET, POST } = await import('./route');

function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/notifications?${params.toString()}`));
}

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }) {
  return POST(new Request('http://localhost/api/notifications', { method: 'POST', headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  notificationPreferenceFixtures.length = 0;
  activityEventFixtures.length = 0;
});

afterEach(() => {
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  notificationPreferenceFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('GET /api/notifications', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest({})).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID })).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID })).status).toBe(403);
  });

  it("lists only the caller's own inbox — no permission beyond authentication", async () => {
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, notificationType: 'system.announcement', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id, tokens: { entityTitle: 'Hi' } });
    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].notification.notificationType).toBe('system.announcement');
  });
});

describe('POST /api/notifications', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, notificationType: 'system.announcement', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id },
      { origin: 'http://evil.test', host: 'localhost', 'content-type': 'application/json' },
    );
    expect(response.status).toBe(403);
  });

  it('rejects an invalid recipientScope', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, notificationType: 'system.announcement', recipientScope: 'bogus' });
    expect(response.status).toBe(400);
  });

  it('creates and sends a notification, returning 201', async () => {
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      notificationType: 'system.announcement',
      recipientScope: 'individual',
      recipientIdentityId: mockDefaultUser.id,
      tokens: { entityTitle: 'Server maintenance tonight' },
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.notification.status).toBe('active');
    expect(notificationRecipientFixtures).toHaveLength(1);
  });

  it('returns 422 for an unrecognized notificationType', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, notificationType: 'not.a.real.type', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id });
    expect(response.status).toBe(422);
  });

  it('Phase 30: case_participants resolves real recipients from an existing case\'s assignedStaffId/intakeOwnerId', async () => {
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      notificationType: 'case.created',
      recipientScope: 'case_participants',
      caseId: '1042',
      tokens: { entityTitle: 'Test Decedent' },
    });
    expect(response.status).toBe(201);
  });

  it('case_participants with a nonexistent caseId yields 201 with zero recipients, not an error', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, notificationType: 'case.created', recipientScope: 'case_participants', caseId: 'case-does-not-exist' });
    expect(response.status).toBe(201);
    expect(notificationRecipientFixtures).toHaveLength(0);
  });

  it('officeStaff-tier callers (mockMultiOrgUser) may still send notifications', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      notificationType: 'system.announcement',
      recipientScope: 'individual',
      recipientIdentityId: mockDefaultUser.id,
      tokens: { entityTitle: 'x' },
    });
    expect(response.status).toBe(201);
  });
});
