import { describe, it, expect } from 'vitest';
import { mapWixNotificationDeliveryAttemptItem, buildWixNotificationDeliveryAttemptData } from './wixNotificationDeliveryAttemptMapper';
import type { NotificationDeliveryAttempt } from '../types/notificationDeliveryAttempt';

const SUCCESSFUL_ATTEMPT: NotificationDeliveryAttempt = {
  id: 'attempt-1',
  organizationId: 'org-1',
  notificationDeliveryId: 'delivery-1',
  succeeded: true,
  errorMessage: null,
  attemptedAt: '2026-08-01T00:00:00.000Z',
};

const FAILED_ATTEMPT: NotificationDeliveryAttempt = {
  ...SUCCESSFUL_ATTEMPT,
  id: 'attempt-2',
  succeeded: false,
  errorMessage: 'SMTP timeout',
};

describe('wixNotificationDeliveryAttemptMapper', () => {
  it('round-trips a successful attempt', () => {
    expect(mapWixNotificationDeliveryAttemptItem(buildWixNotificationDeliveryAttemptData(SUCCESSFUL_ATTEMPT))).toEqual(SUCCESSFUL_ATTEMPT);
  });

  it('round-trips a failed attempt with an error message', () => {
    expect(mapWixNotificationDeliveryAttemptItem(buildWixNotificationDeliveryAttemptData(FAILED_ATTEMPT))).toEqual(FAILED_ATTEMPT);
  });

  it('returns null for undefined', () => {
    expect(mapWixNotificationDeliveryAttemptItem(undefined)).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixNotificationDeliveryAttemptItem({ ...buildWixNotificationDeliveryAttemptData(SUCCESSFUL_ATTEMPT), succeeded: 'true' })).toBeNull();
  });

  it('exposes no apply/update function — insert-only, mirroring SignatureRecord', async () => {
    const moduleExports = await import('./wixNotificationDeliveryAttemptMapper');
    const exportNames = Object.keys(moduleExports);
    expect(exportNames.some((name) => /^apply/i.test(name))).toBe(false);
  });
});
