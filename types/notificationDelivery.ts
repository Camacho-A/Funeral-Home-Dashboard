/**
 * Phase 28 (Communications & Notifications). A `NotificationDelivery`
 * represents *how it was sent* — one row per `(recipient, channel)`. It
 * carries **zero notification content**: no title, no body, nothing a
 * reader would need beyond the `notificationId` it references. `sms`
 * added in Phase 33 (Real Notification Delivery). Still reserved, not
 * implemented: push, webhooks — see that phase's own ADR-037 for why.
 * See docs/adr/ADR-032-communications-and-notifications.md.
 */
export type NotificationChannel = 'in_app' | 'email' | 'sms';

/**
 * Fully independent of `Notification.status` (types/notification.ts) —
 * a Notification can be `active` while individual Delivery rows are still
 * `pending` or have reached `failed`; a Delivery reaching `read` never
 * changes the Notification's own status at all. `Pending -> Sent ->
 * Delivered -> Read`, or `Failed` from any of the first three.
 *
 * `queued_for_digest` (Phase 33) is a distinct pre-`pending` holding
 * state: an `email` delivery whose recipient has a non-instant
 * `digestFrequency`, or whose org-local time is inside their quiet
 * hours, is persisted here instead of attempted immediately. Only
 * `services/notificationDigestService.ts`'s sweep ever moves a row out
 * of this status (into `sent` or `failed`) — see that file's own header
 * comment. `in_app` and `sms` deliveries never enter this status.
 */
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'queued_for_digest';

export type NotificationDelivery = {
  /** Deterministic: `${notificationRecipientId}-${channel}`. */
  id: string;
  organizationId: string;
  notificationId: string;
  notificationRecipientId: string;
  /** Denormalized from NotificationRecipient — makes the unread-badge
      query a single `(organizationId, identityId, channel, status)`
      filter, never a join through NotificationRecipient. */
  identityId: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  createdAt: string;
};
