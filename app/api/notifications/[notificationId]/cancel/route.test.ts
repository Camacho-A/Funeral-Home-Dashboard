import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { notificationFixtures, notificationRecipientFixtures, notificationDeliveryFixtures, notificationDeliveryAttemptFixtures } from '@/services/__mocks__/notificationFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { POST } = await import('./route');
const { createNotification } = await import('@/services/notificationService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-cancel-notif-${idCounter}`;
}
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

function postRequest(notificationId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }) {
  return POST(new Request(`http://localhost/api/notifications/${notificationId}/cancel`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ notificationId }) });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  activityEventFixtures.length = 0;
});

afterEach(() => {
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('POST /api/notifications/[notificationId]/cancel', () => {
  it('cancels a draft notification', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id, saveAsDraft: true, idFactory, tokens: {} },
      SEED_CTX,
      'mock',
    );
    const response = await postRequest(notification.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    expect((await response.json()).notification.status).toBe('cancelled');
  });

  it('returns 422 for a notification that has already reached active', async () => {
    const notification = await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id, idFactory, tokens: {} }, SEED_CTX, 'mock');
    const response = await postRequest(notification.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(422);
  });

  it('requires notification.manage-tier authority — officeStaff (notification.send only) is denied', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id, saveAsDraft: true, idFactory, tokens: {} },
      SEED_CTX,
      'mock',
    );
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(notification.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });
});
