import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import {
  notificationFixtures,
  notificationRecipientFixtures,
  notificationDeliveryFixtures,
  notificationDeliveryAttemptFixtures,
} from '@/services/__mocks__/notificationFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');
const { createNotification } = await import('@/services/notificationService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-recipient-${idCounter}`;
}
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

function patchRequest(notificationRecipientId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }) {
  return PATCH(new Request(`http://localhost/api/notifications/recipients/${notificationRecipientId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ notificationRecipientId }),
  });
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

describe('PATCH /api/notifications/recipients/[notificationRecipientId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest('anything', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'read' }, { origin: 'http://evil.test', host: 'localhost', 'content-type': 'application/json' });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid action', async () => {
    const response = await patchRequest('anything', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'delete' });
    expect(response.status).toBe(400);
  });

  it('marks read, transitioning the in-app delivery to read', async () => {
    const notification = await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id, idFactory, tokens: {} }, SEED_CTX, 'mock');
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification.id)!;

    const response = await patchRequest(recipient.id, { organizationId: DEFAULT_ORGANIZATION_ID, action: 'read' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recipient.readAt).not.toBeNull();
    expect(notificationDeliveryFixtures.find((d) => d.notificationRecipientId === recipient.id && d.channel === 'in_app')?.status).toBe('read');
  });

  it('archives', async () => {
    const notification = await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id, idFactory, tokens: {} }, SEED_CTX, 'mock');
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification.id)!;

    const response = await patchRequest(recipient.id, { organizationId: DEFAULT_ORGANIZATION_ID, action: 'archive' });
    expect(response.status).toBe(200);
    expect((await response.json()).recipient.archivedAt).not.toBeNull();
  });

  it('returns 404 for an unknown recipient row', async () => {
    const response = await patchRequest('does-not-exist', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'read' });
    expect(response.status).toBe(404);
  });

  it("returns 403 when the recipient row belongs to someone else's identity, even for an otherwise-authorized org member", async () => {
    const notification = await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: mockDefaultUser.id, idFactory, tokens: {} }, SEED_CTX, 'mock');
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification.id)!;

    mockSession = { user: mockMultiOrgUser };
    const response = await patchRequest(recipient.id, { organizationId: DEFAULT_ORGANIZATION_ID, action: 'read' });
    expect(response.status).toBe(403);
  });
});
