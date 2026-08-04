import { describe, expect, it } from 'vitest';
import { resolveNotificationContent } from './notificationTemplateRegistry';
import { NOTIFICATION_TYPES } from './notificationTypeRegistry';

describe('resolveNotificationContent', () => {
  it('interpolates recognized tokens into title/body', () => {
    const content = resolveNotificationContent(NOTIFICATION_TYPES.TASK_ASSIGNED.key, { actorDisplayName: 'Dana Reyes', entityTitle: 'Call the cemetery' });
    expect(content.title).toBe('Task assigned');
    expect(content.body).toBe('Dana Reyes assigned you: "Call the cemetery"');
    expect(content.actionUrl).toBeNull();
  });

  it('resolves every registered notification type to non-empty structured content', () => {
    for (const definition of Object.values(NOTIFICATION_TYPES)) {
      const content = resolveNotificationContent(definition.key, {
        recipientDisplayName: 'Jane Staff',
        actorDisplayName: 'Dana Reyes',
        caseNumber: 'B2026-014',
        decedentName: 'Robert Ellison',
        entityTitle: 'Cremation Authorization.pdf',
      });
      expect(content.title.length).toBeGreaterThan(0);
      expect(content.body.length).toBeGreaterThan(0);
    }
  });

  it('a recognized token absent from the call resolves to an empty string, never throwing', () => {
    const content = resolveNotificationContent(NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT.key, {});
    expect(content.body).toBe('');
  });

  it('passes actionUrl through untouched', () => {
    const content = resolveNotificationContent(NOTIFICATION_TYPES.TASK_ASSIGNED.key, { entityTitle: 'x' }, '/tasks/123');
    expect(content.actionUrl).toBe('/tasks/123');
  });

  it('throws for an unrecognized notification type', () => {
    expect(() => resolveNotificationContent('not.a.real.type', {})).toThrow(/Unrecognized notification type/);
  });
});
