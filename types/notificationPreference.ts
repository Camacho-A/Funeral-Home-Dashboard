/**
 * Phase 28 (Communications & Notifications). One row per
 * `(organizationId, identityId)`. A missing row resolves to hardcoded
 * defaults (`emailEnabled: true`, `inAppEnabled: true`) rather than
 * requiring eager seeding for every existing membership.
 *
 * This phase implements only a global per-identity toggle — but the
 * shape is deliberately ready for a future, purely additive
 * `categoryOverrides` field (a `Record<NotificationCategory, { emailEnabled;
 * inAppEnabled }>`-shaped object) via the same "resend the full field
 * list via `PUT /v2/collections`" mechanism this codebase has already
 * used repeatedly — never a redesign of this collection or a migration
 * for existing rows, which would simply keep resolving to no override
 * (global toggle only) until a user sets one. Not implemented this phase.
 *
 * `digestFrequency`/`quietHoursStart`/`quietHoursEnd`/`smsEnabled` are
 * schema-only reserves — no batching/suppression logic runs against them,
 * and no UI control exists for them this phase.
 * See docs/adr/ADR-032-communications-and-notifications.md.
 */
export type DigestFrequency = 'instant' | 'daily' | 'weekly';

export type NotificationPreference = {
  /** Deterministic: `${organizationId}-${identityId}`. */
  id: string;
  organizationId: string;
  identityId: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  /** Reserved — no batching engine runs against this yet. */
  digestFrequency: DigestFrequency;
  /** Reserved, e.g. "22:00" — not enforced. */
  quietHoursStart: string | null;
  /** Reserved — not enforced. */
  quietHoursEnd: string | null;
  /** Reserved, always false — no SMS channel exists yet. */
  smsEnabled: boolean;
  updatedAt: string;
};

export type NotificationPreferencePatch = {
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCE: Omit<NotificationPreference, 'id' | 'organizationId' | 'identityId' | 'updatedAt'> = {
  emailEnabled: true,
  inAppEnabled: true,
  digestFrequency: 'instant',
  quietHoursStart: null,
  quietHoursEnd: null,
  smsEnabled: false,
};
