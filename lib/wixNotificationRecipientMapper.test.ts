import { describe, it, expect } from 'vitest';
import { mapWixNotificationRecipientItem, buildWixNotificationRecipientData, applyNotificationRecipientUpdateToWixData } from './wixNotificationRecipientMapper';
import type { NotificationRecipient } from '../types/notificationRecipient';

const RECIPIENT: NotificationRecipient = {
  id: 'notif-1-identity-1',
  organizationId: 'org-1',
  notificationId: 'notif-1',
  identityId: 'identity-1',
  readAt: null,
  archivedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('wixNotificationRecipientMapper', () => {
  it('round-trips an unread recipient row', () => {
    expect(mapWixNotificationRecipientItem(buildWixNotificationRecipientData(RECIPIENT))).toEqual(RECIPIENT);
  });

  it('round-trips a read and archived recipient row', () => {
    const readRecipient: NotificationRecipient = { ...RECIPIENT, readAt: '2026-08-02T00:00:00.000Z', archivedAt: '2026-08-03T00:00:00.000Z' };
    expect(mapWixNotificationRecipientItem(buildWixNotificationRecipientData(readRecipient))).toEqual(readRecipient);
  });

  it('returns null for undefined', () => {
    expect(mapWixNotificationRecipientItem(undefined)).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixNotificationRecipientItem({ ...buildWixNotificationRecipientData(RECIPIENT), identityId: undefined })).toBeNull();
  });

  it('applyNotificationRecipientUpdateToWixData changes only readAt/archivedAt', () => {
    const wixItem = buildWixNotificationRecipientData(RECIPIENT);
    const updated = applyNotificationRecipientUpdateToWixData(wixItem, { readAt: '2026-08-02T00:00:00.000Z' });
    expect(updated.readAt).toBe('2026-08-02T00:00:00.000Z');
    expect(updated.archivedAt).toBeNull();
    expect(updated.identityId).toBe(wixItem.identityId);
  });
});
