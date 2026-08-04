import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { notificationFixtures, notificationRecipientFixtures, notificationDeliveryFixtures, notificationDeliveryAttemptFixtures } from '@/services/__mocks__/notificationFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET } = await import('./route');
const { createNotification } = await import('@/services/notificationService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-org-log-${idCounter}`;
}
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

function getRequest(organizationId: string, query: Record<string, string> = {}) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/organizations/${organizationId}/notifications?${params.toString()}`), { params: Promise.resolve({ organizationId }) });
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

describe('GET /api/organizations/[organizationId]/notifications', () => {
  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('lists every notification in the organization as a plain projection', async () => {
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id, idFactory, tokens: {} }, SEED_CTX, 'mock');
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect((await response.json()).notifications).toHaveLength(1);
  });

  it('requires notification.read-tier authority — officeStaff (notification.send only) is denied', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });
});
