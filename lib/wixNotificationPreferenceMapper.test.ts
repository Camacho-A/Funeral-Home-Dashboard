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
  categoryOverrides: {},
  lastDigestSentAt: null,
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

  it('applyNotificationPreferenceUpdateToWixData patches only the given fields', () => {
    const wixItem = buildWixNotificationPreferenceData(PREFERENCE);
    const updated = applyNotificationPreferenceUpdateToWixData(wixItem, { emailEnabled: false, updatedAt: '2026-08-02T00:00:00.000Z' });
    expect(updated.emailEnabled).toBe(false);
    expect(updated.inAppEnabled).toBe(true);
    expect(updated.digestFrequency).toBe(wixItem.digestFrequency);
  });

  it('round-trips a real categoryOverrides map (Phase 33)', () => {
    const withOverrides: NotificationPreference = {
      ...PREFERENCE,
      categoryOverrides: { task: { emailEnabled: false, inAppEnabled: true, smsEnabled: true } },
    };
    expect(mapWixNotificationPreferenceItem(buildWixNotificationPreferenceData(withOverrides))).toEqual(withOverrides);
  });

  it('degrades a malformed categoryOverrides column to an empty map rather than failing the whole row', () => {
    const wixItem = { ...buildWixNotificationPreferenceData(PREFERENCE), categoryOverrides: 'not json' };
    expect(mapWixNotificationPreferenceItem(wixItem)?.categoryOverrides).toEqual({});
  });

  it('applyNotificationPreferenceUpdateToWixData can patch digestFrequency/quietHours/smsEnabled/categoryOverrides/lastDigestSentAt (Phase 33)', () => {
    const wixItem = buildWixNotificationPreferenceData(PREFERENCE);
    const updated = applyNotificationPreferenceUpdateToWixData(wixItem, {
      smsEnabled: true,
      digestFrequency: 'daily',
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      categoryOverrides: { task: { emailEnabled: false, inAppEnabled: true, smsEnabled: false } },
      lastDigestSentAt: '2026-08-03T00:00:00.000Z',
    });
    expect(updated.smsEnabled).toBe(true);
    expect(updated.digestFrequency).toBe('daily');
    expect(updated.quietHoursStart).toBe('22:00');
    expect(updated.quietHoursEnd).toBe('07:00');
    expect(updated.lastDigestSentAt).toBe('2026-08-03T00:00:00.000Z');
    expect(JSON.parse(updated.categoryOverrides as string)).toEqual({ task: { emailEnabled: false, inAppEnabled: true, smsEnabled: false } });
  });
});
