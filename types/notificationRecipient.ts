/**
 * Phase 28 (Communications & Notifications). The immutable resolution
 * snapshot — one row per `(notification, identity)`, computed exactly
 * once when the notification is created and never recomputed. A
 * `role`/`organization_wide`/`case_participants` notification is a frozen
 * snapshot of who mattered *then*; a membership added or changed
 * afterward never retroactively gains or loses that earlier notification.
 * See docs/adr/ADR-032-communications-and-notifications.md.
 */
export type NotificationRecipient = {
  /** Deterministic: `${notificationId}-${identityId}` — mirrors
      AppointmentResourceAssignment's own deterministic-id convention. */
  id: string;
  organizationId: string;
  notificationId: string;
  identityId: string;
  /** Denormalized convenience fields only. The source of truth for "was
      this read" is this recipient's own in-app NotificationDelivery row
      reaching 'read' — these exist purely so the unread badge and the
      "hide archived" filter are a single indexed query, never a join,
      and never a separately-maintained counter that could drift. Both
      are stamped by the same NotificationService call that also
      transitions the in-app Delivery. */
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};
