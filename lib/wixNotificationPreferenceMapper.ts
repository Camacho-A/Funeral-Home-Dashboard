import type { NotificationPreference, DigestFrequency } from '../types/notificationPreference';

/**
 * Phase 28 (Communications & Notifications). Standard mapper pair for the
 * `notificationPreferences` collection. Only `emailEnabled`/`inAppEnabled`
 * are ever patched by this phase's UI/routes — `digestFrequency`/
 * `quietHoursStart`/`quietHoursEnd`/`smsEnabled` are schema-only reserves
 * (see types/notificationPreference.ts's own header comment).
 */
export type WixNotificationPreferenceItem = {
  beaconNotificationPreferenceId?: unknown;
  organizationId?: unknown;
  identityId?: unknown;
  emailEnabled?: unknown;
  inAppEnabled?: unknown;
  digestFrequency?: unknown;
  quietHoursStart?: unknown;
  quietHoursEnd?: unknown;
  smsEnabled?: unknown;
  updatedAt?: unknown;
};

const VALID_DIGEST_FREQUENCIES: readonly string[] = ['instant', 'daily', 'weekly'];

function isDigestFrequency(value: unknown): value is DigestFrequency {
  return typeof value === 'string' && VALID_DIGEST_FREQUENCIES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixNotificationPreferenceItem(item: WixNotificationPreferenceItem | undefined): NotificationPreference | null {
  if (
    !item ||
    typeof item.beaconNotificationPreferenceId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.identityId !== 'string' ||
    typeof item.emailEnabled !== 'boolean' ||
    typeof item.inAppEnabled !== 'boolean' ||
    !isDigestFrequency(item.digestFrequency) ||
    !isStringOrNull(item.quietHoursStart) ||
    !isStringOrNull(item.quietHoursEnd) ||
    typeof item.smsEnabled !== 'boolean' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconNotificationPreferenceId,
    organizationId: item.organizationId,
    identityId: item.identityId,
    emailEnabled: item.emailEnabled,
    inAppEnabled: item.inAppEnabled,
    digestFrequency: item.digestFrequency,
    quietHoursStart: item.quietHoursStart,
    quietHoursEnd: item.quietHoursEnd,
    smsEnabled: item.smsEnabled,
    updatedAt: item.updatedAt,
  };
}

export function buildWixNotificationPreferenceData(preference: NotificationPreference): WixNotificationPreferenceItem {
  return {
    beaconNotificationPreferenceId: preference.id,
    organizationId: preference.organizationId,
    identityId: preference.identityId,
    emailEnabled: preference.emailEnabled,
    inAppEnabled: preference.inAppEnabled,
    digestFrequency: preference.digestFrequency,
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    smsEnabled: preference.smsEnabled,
    updatedAt: preference.updatedAt,
  };
}

export function applyNotificationPreferenceUpdateToWixData(
  existing: WixNotificationPreferenceItem,
  patch: Partial<Pick<WixNotificationPreferenceItem, 'emailEnabled' | 'inAppEnabled' | 'updatedAt'>>,
): WixNotificationPreferenceItem {
  return { ...existing, ...patch };
}
