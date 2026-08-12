import type { NotificationCategory } from '../domain/notifications/notificationTypeRegistry';

/**
 * Phase 28 (Communications & Notifications). One row per
 * `(organizationId, identityId)`. A missing row resolves to hardcoded
 * defaults (`emailEnabled: true`, `inAppEnabled: true`) rather than
 * requiring eager seeding for every existing membership.
 *
 * Phase 33 (Real Notification Delivery) activates every field below that
 * Phase 28 had reserved but left unenforced: `digestFrequency`/
 * `quietHoursStart`/`quietHoursEnd` now gate real deferral logic in
 * `services/notificationService.ts#dispatchChannel`, flushed by
 * `services/notificationDigestService.ts`'s cron-triggered sweep;
 * `smsEnabled` now gates the real `sms` channel (see
 * `services/notifications/smsChannel.ts`) — a recipient with this on but
 * no `Identity.phone` set is silently skipped, never an error.
 * `categoryOverrides` is the field this file's own Phase 28 comment
 * named as a future, purely additive addition — built now, via the same
 * "resend the full field list" mechanism, no migration needed (a missing
 * override for a given category simply falls back to the global toggle).
 * See docs/adr/ADR-037-real-notification-delivery.md.
 */
export type DigestFrequency = 'instant' | 'daily' | 'weekly';

export type NotificationCategoryOverride = {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  smsEnabled: boolean;
};

export type NotificationPreference = {
  /** Deterministic: `${organizationId}-${identityId}`. */
  id: string;
  organizationId: string;
  identityId: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  digestFrequency: DigestFrequency;
  /** e.g. "22:00", org-local (Organization.timezone, UTC fallback). */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  smsEnabled: boolean;
  /** Per-category override of the three global toggles above — absent
      for a category means "use the global toggle." Never a category
      key that isn't a real `NotificationCategory`. */
  categoryOverrides: Partial<Record<NotificationCategory, NotificationCategoryOverride>>;
  /** Null until this identity's first digest send. Anchors the
      `digestFrequency` interval check — see
      `services/notificationDigestService.ts`. Never touched by anything
      other than that sweep. */
  lastDigestSentAt: string | null;
  updatedAt: string;
};

export type NotificationPreferencePatch = {
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
  smsEnabled?: boolean;
  digestFrequency?: DigestFrequency;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  categoryOverrides?: Partial<Record<NotificationCategory, NotificationCategoryOverride>>;
};

export const DEFAULT_NOTIFICATION_PREFERENCE: Omit<NotificationPreference, 'id' | 'organizationId' | 'identityId' | 'updatedAt'> = {
  emailEnabled: true,
  inAppEnabled: true,
  digestFrequency: 'instant',
  quietHoursStart: null,
  quietHoursEnd: null,
  smsEnabled: false,
  categoryOverrides: {},
  lastDigestSentAt: null,
};
