/**
 * Phase 28 (Communications & Notifications). An immutable, insert-only
 * log of every actual delivery try for a `NotificationDelivery` — mirrors
 * `SignatureRecord`'s own insert-only precedent exactly: never updated,
 * never deleted, once created. A `NotificationDelivery` can accumulate
 * many attempts (e.g. a retried email); nothing here is ever overwritten,
 * only appended. See docs/adr/ADR-032-communications-and-notifications.md.
 */
export type NotificationDeliveryAttempt = {
  id: string;
  organizationId: string;
  notificationDeliveryId: string;
  succeeded: boolean;
  errorMessage: string | null;
  attemptedAt: string;
};
