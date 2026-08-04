import { describe, it, expect } from 'vitest';
import { mapWixNotificationPreferenceItem, buildWixNotificationPreferenceData, applyNotificationPreferenceUpdateToWixData } from './wixNotificationPreferenceMapper';
import type { NotificationPreference } from '../types/notificationPreference';

const PREFERENCE: NotificationPreference = {
  id: 'org-1-identity-1',
  organizationId: 'org-1',
  identityId: 'identity-1',
  emailEnabled: true,
  inAppEnabled: true,
  digestFrequency: 'instant',
  quietHoursStart: null,
  quietHoursEnd: null,
  smsEnabled: false,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('wixNotificationPreferenceMapper', () => {
  it('round-trips a default preference row', () => {
    expect(mapWixNotificationPreferenceItem(buildWixNotificationPreferenceData(PREFERENCE))).toEqual(PREFERENCE);
  });

  it('returns null for undefined', () => {
    expect(mapWixNotificationPreferenceItem(undefined)).toBeNull();
  });

  it('returns null for an invalid digestFrequency', () => {
    expect(mapWixNotificationPreferenceItem({ ...buildWixNotificationPreferenceData(PREFERENCE), digestFrequency: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixNotificationPreferenceItem({ ...buildWixNotificationPreferenceData(PREFERENCE), emailEnabled: 'true' })).toBeNull();
  });

  it('applyNotificationPreferenceUpdateToWixData changes only emailEnabled/inAppEnabled/updatedAt', () => {
    const wixItem = buildWixNotificationPreferenceData(PREFERENCE);
    const updated = applyNotificationPreferenceUpdateToWixData(wixItem, { emailEnabled: false, updatedAt: '2026-08-02T00:00:00.000Z' });
    expect(updated.emailEnabled).toBe(false);
    expect(updated.inAppEnabled).toBe(true);
    expect(updated.digestFrequency).toBe(wixItem.digestFrequency);
  });
});
