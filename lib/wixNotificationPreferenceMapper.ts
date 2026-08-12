import type { NotificationPreference, DigestFrequency, NotificationCategoryOverride } from '../types/notificationPreference';
import type { NotificationCategory } from '../domain/notifications/notificationTypeRegistry';

/**
 * Phase 28 (Communications & Notifications). Standard mapper pair for the
 * `notificationPreferences` collection.
 *
 * Phase 33 (Real Notification Delivery): `digestFrequency`/
 * `quietHoursStart`/`quietHoursEnd`/`smsEnabled` are now real, patchable
 * fields (previously schema-only reserves — see
 * types/notificationPreference.ts's own header comment). `categoryOverrides`
 * is stored as a JSON-serialized Text field — mirrors
 * `ReportPreset.filters`'s identical "structured value, plain Text column"
 * precedent (Phase 32) — parsed/stringified only in this file, never
 * elsewhere. `lastDigestSentAt` is written only by
 * `services/notificationDigestService.ts`'s sweep, never by the
 * preferences-update route.
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
  /** JSON-serialized `Partial<Record<NotificationCategory, NotificationCategoryOverride>>`. */
  categoryOverrides?: unknown;
  lastDigestSentAt?: unknown;
  updatedAt?: unknown;
};

const VALID_DIGEST_FREQUENCIES: readonly string[] = ['instant', 'daily', 'weekly'];

function isDigestFrequency(value: unknown): value is DigestFrequency {
  return typeof value === 'string' && VALID_DIGEST_FREQUENCIES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCategoryOverride(value: unknown): value is NotificationCategoryOverride {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).emailEnabled === 'boolean' &&
    typeof (value as Record<string, unknown>).inAppEnabled === 'boolean' &&
    typeof (value as Record<string, unknown>).smsEnabled === 'boolean'
  );
}

/** Parses the JSON-serialized `categoryOverrides` column, discarding (not
    throwing on) any entry that isn't a real category or the right shape —
    a malformed/legacy row degrades to "no overrides" rather than failing
    the whole preference to map. */
function parseCategoryOverrides(raw: unknown): Partial<Record<NotificationCategory, NotificationCategoryOverride>> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Partial<Record<NotificationCategory, NotificationCategoryOverride>> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isCategoryOverride(value)) result[key as NotificationCategory] = value;
    }
    return result;
  } catch {
    return {};
  }
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
    !isStringOrNull(item.lastDigestSentAt) ||
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
    categoryOverrides: parseCategoryOverrides(item.categoryOverrides),
    lastDigestSentAt: item.lastDigestSentAt,
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
    categoryOverrides: JSON.stringify(preference.categoryOverrides),
    lastDigestSentAt: preference.lastDigestSentAt,
    updatedAt: preference.updatedAt,
  };
}

export function applyNotificationPreferenceUpdateToWixData(
  existing: WixNotificationPreferenceItem,
  patch: Partial<{
    emailEnabled: boolean;
    inAppEnabled: boolean;
    smsEnabled: boolean;
    digestFrequency: DigestFrequency;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    categoryOverrides: Partial<Record<NotificationCategory, NotificationCategoryOverride>>;
    lastDigestSentAt: string | null;
    updatedAt: string;
  }>,
): WixNotificationPreferenceItem {
  const next: WixNotificationPreferenceItem = { ...existing };
  if (patch.emailEnabled !== undefined) next.emailEnabled = patch.emailEnabled;
  if (patch.inAppEnabled !== undefined) next.inAppEnabled = patch.inAppEnabled;
  if (patch.smsEnabled !== undefined) next.smsEnabled = patch.smsEnabled;
  if (patch.digestFrequency !== undefined) next.digestFrequency = patch.digestFrequency;
  if (patch.quietHoursStart !== undefined) next.quietHoursStart = patch.quietHoursStart;
  if (patch.quietHoursEnd !== undefined) next.quietHoursEnd = patch.quietHoursEnd;
  if (patch.categoryOverrides !== undefined) next.categoryOverrides = JSON.stringify(patch.categoryOverrides);
  if (patch.lastDigestSentAt !== undefined) next.lastDigestSentAt = patch.lastDigestSentAt;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
