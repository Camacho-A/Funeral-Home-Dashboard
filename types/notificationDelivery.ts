/**
 * Phase 28 (Communications & Notifications). A `NotificationDelivery`
 * represents *how it was sent* — one row per `(recipient, channel)`. It
 * carries **zero notification content**: no title, no body, nothing a
 * reader would need beyond the `notificationId` it references. Today:
 * `in_app` and `email`. Future, reserved, not implemented: SMS, push,
 * webhooks. See docs/adr/ADR-032-communications-and-notifications.md.
 */
export type NotificationChannel = 'in_app' | 'email';

/**
 * Fully independent of `Notification.status` (types/notification.ts) —
 * a Notification can be `active` while individual Delivery rows are still
 * `pending` or have reached `failed`; a Delivery reaching `read` never
 * changes the Notification's own status at all. `Pending -> Sent ->
 * Delivered -> Read`, or `Failed` from any of the first three.
 */
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

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
