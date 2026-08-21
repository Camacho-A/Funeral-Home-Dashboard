import { describe, expect, it } from 'vitest';
import type { NotificationCategory } from './notificationTypeRegistry';
import { NOTIFICATION_TYPES, getNotificationTypeDefinition, isValidNotificationTypeKey } from './notificationTypeRegistry';

const CATEGORIES: NotificationCategory[] = ['case', 'task', 'payment', 'scheduling', 'document', 'signature', 'organization', 'system', 'family_portal', 'financial', 'commerce'];

describe('NOTIFICATION_TYPES', () => {
  it('every entry has a distinct key', () => {
    const keys = Object.values(NOTIFICATION_TYPES).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every entry's displayName is never derived from (or equal to) its own dot-notation key", () => {
    for (const entry of Object.values(NOTIFICATION_TYPES)) {
      expect(entry.displayName).not.toBe(entry.key);
      expect(entry.displayName).not.toContain('.');
    }
  });

  it("every entry's category is one of the eleven defined categories", () => {
    for (const entry of Object.values(NOTIFICATION_TYPES)) {
      expect(CATEGORIES).toContain(entry.category);
    }
  });

  it('covers every one of the ten categories with at least one entry', () => {
    const usedCategories = new Set(Object.values(NOTIFICATION_TYPES).map((entry) => entry.category));
    for (const category of CATEGORIES) {
      expect(usedCategories.has(category), `expected at least one notification type in category "${category}"`).toBe(true);
    }
  });

  it('uses "scheduling", never "appointment", as the category for appointment-related types', () => {
    expect(NOTIFICATION_TYPES.APPOINTMENT_CREATED.category).toBe('scheduling');
    expect(NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED.category).toBe('scheduling');
    expect(NOTIFICATION_TYPES.APPOINTMENT_CANCELLED.category).toBe('scheduling');
    expect(NOTIFICATION_TYPES.APPOINTMENT_REMINDER.category).toBe('scheduling');
  });

  it('Phase 34: registers scheduling.appointment_reminder (staff) and system.calendar_sync_failed', () => {
    expect(NOTIFICATION_TYPES.APPOINTMENT_REMINDER.key).toBe('scheduling.appointment_reminder');
    expect(NOTIFICATION_TYPES.CALENDAR_SYNC_FAILED.key).toBe('system.calendar_sync_failed');
    expect(NOTIFICATION_TYPES.CALENDAR_SYNC_FAILED.category).toBe('system');
  });

  it('includes every notification type named in the approved plan', () => {
    const keys = Object.values(NOTIFICATION_TYPES).map((entry) => entry.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'scheduling.appointment_created',
        'scheduling.appointment_rescheduled',
        'scheduling.appointment_cancelled',
        'task.assigned',
        'signature.completed',
        'signature.declined',
        'case.created',
        'document.generated',
        'payment.received',
        'organization.member_joined',
        'system.announcement',
      ]),
    );
  });
});

describe('isValidNotificationTypeKey / getNotificationTypeDefinition', () => {
  it('recognizes a real key', () => {
    expect(isValidNotificationTypeKey('task.assigned')).toBe(true);
    expect(getNotificationTypeDefinition('task.assigned')?.displayName).toBe('Task Assigned');
  });

  it('rejects an unrecognized key', () => {
    expect(isValidNotificationTypeKey('not.a.real.key')).toBe(false);
    expect(getNotificationTypeDefinition('not.a.real.key')).toBeNull();
  });
});
