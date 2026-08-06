/**
 * Phase 28 (Communications & Notifications). A `Notification` represents
 * *what happened* — content, category, and the domain object it
 * originated from. It carries **zero delivery state**: no channel, no
 * per-recipient read/archived flag, no delivery attempt history. Every
 * one of those lives on `NotificationDelivery`
 * (types/notificationDelivery.ts) instead — never a field on this type.
 * See docs/adr/ADR-032-communications-and-notifications.md.
 */

/**
 * This lifecycle describes only whether the notification itself has been
 * produced and is currently visible — it says nothing about whether any
 * individual recipient has read it. That is `NotificationDelivery`'s own,
 * fully independent lifecycle (see that type's header comment).
 * `Cancelled` is only reachable from `Draft`/`Queued`, before `Active`.
 */
export type NotificationStatus = 'draft' | 'queued' | 'active' | 'archived' | 'cancelled';

const TERMINAL_NOTIFICATION_STATUSES: readonly NotificationStatus[] = ['archived', 'cancelled'];

export function isTerminalNotificationStatus(status: NotificationStatus): boolean {
  return TERMINAL_NOTIFICATION_STATUSES.includes(status);
}

/** How the set of recipients was determined — resolved exactly once, at
    creation time, into an immutable `NotificationRecipient` snapshot
    (types/notificationRecipient.ts). A future role change never rewrites
    a historical notification's recipient list.

    `'portal_user'` (Phase 29 — Family Portal & External Collaboration) is
    the one scope whose recipient is a `PortalUser.id`, never an
    `Identity.id` — see `services/notificationService.ts`'s
    `dispatchChannel` for the resulting email-resolution fallback this
    requires. Never conflated with `'individual'`, which is always
    Identity-space. */
export type RecipientScope = 'individual' | 'role' | 'organization_wide' | 'case_participants' | 'portal_user';

export type Notification = {
  id: string;
  organizationId: string;
  /** A domain/notifications/notificationTypeRegistry.ts NOTIFICATION_TYPES[...].key
      — validated at the service boundary, never a hardcoded union here
      (mirrors Appointment.appointmentType's exact convention). */
  notificationType: string;
  category: string;
  title: string;
  body: string;
  actionUrl: string | null;
  /** Polymorphic reference to the domain object this notification is
      about — e.g. 'appointment' / 'signatureRequest' / 'task' / 'case' —
      deliberately generic (never a dedicated caseId field) so Notification
      never needs to know about any specific domain module. */
  entityType: string | null;
  entityId: string | null;
  recipientScope: RecipientScope;
  /** Set only when recipientScope === 'role'. */
  recipientRoleKey: string | null;
  status: NotificationStatus;
  /** Who or what triggered this — null for a system-generated notification. */
  actorIdentityId: string | null;
  /** Shared with every ActivityEvent this notification's own lifecycle produces. */
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

export type NewNotificationInput = {
  notificationType: string;
  entityType?: string;
  entityId?: string;
  recipientScope: RecipientScope;
  recipientRoleKey?: string;
  /** Only meaningful when recipientScope === 'individual'. */
  recipientIdentityId?: string;
  /** Only meaningful when recipientScope === 'portal_user'. A `PortalUser.id`,
      never an `Identity.id` — see `RecipientScope`'s own comment. */
  recipientPortalUserId?: string;
  /** Only meaningful when recipientScope === 'case_participants'. */
  caseId?: string;
  actionUrl?: string;
  /** Token values passed to domain/notifications/notificationTemplateRegistry.ts's
      resolveNotificationContent — never a pre-formatted title/body here. */
  tokens?: Record<string, string>;
  saveAsDraft?: boolean;
};
