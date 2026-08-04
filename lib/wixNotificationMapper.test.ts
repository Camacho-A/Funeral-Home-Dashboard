import { describe, it, expect } from 'vitest';
import { mapWixNotificationItem, buildWixNotificationData, applyNotificationPatchToWixData } from './wixNotificationMapper';
import type { Notification } from '../types/notification';

const NOTIFICATION: Notification = {
  id: 'notif-1',
  organizationId: 'org-1',
  notificationType: 'task.assigned',
  category: 'task',
  title: 'Task assigned',
  body: 'Dana assigned you: "Call the cemetery"',
  actionUrl: '/tasks/123',
  entityType: 'task',
  entityId: 'task-123',
  recipientScope: 'individual',
  recipientRoleKey: null,
  status: 'active',
  actorIdentityId: 'identity-1',
  correlationId: 'corr-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const ROLE_NOTIFICATION: Notification = {
  ...NOTIFICATION,
  id: 'notif-2',
  recipientScope: 'role',
  recipientRoleKey: 'funeralDirector',
  actionUrl: null,
  entityType: null,
  entityId: null,
  actorIdentityId: null,
};

describe('wixNotificationMapper', () => {
  it('round-trips an individual-scope notification', () => {
    expect(mapWixNotificationItem(buildWixNotificationData(NOTIFICATION))).toEqual(NOTIFICATION);
  });

  it('round-trips a role-scope notification with null optional fields', () => {
    expect(mapWixNotificationItem(buildWixNotificationData(ROLE_NOTIFICATION))).toEqual(ROLE_NOTIFICATION);
  });

  it('returns null for undefined', () => {
    expect(mapWixNotificationItem(undefined)).toBeNull();
  });

  it('returns null for an invalid status/recipientScope', () => {
    expect(mapWixNotificationItem({ ...buildWixNotificationData(NOTIFICATION), status: 'bogus' })).toBeNull();
    expect(mapWixNotificationItem({ ...buildWixNotificationData(NOTIFICATION), recipientScope: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixNotificationItem({ ...buildWixNotificationData(NOTIFICATION), correlationId: undefined })).toBeNull();
  });

  it('applyNotificationPatchToWixData changes only the patched fields', () => {
    const wixItem = buildWixNotificationData(NOTIFICATION);
    const updated = applyNotificationPatchToWixData(wixItem, { status: 'archived' });
    expect(updated.status).toBe('archived');
    expect(updated.title).toBe(wixItem.title);
  });
});
