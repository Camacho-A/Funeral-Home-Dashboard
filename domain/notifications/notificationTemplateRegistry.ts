import { isValidNotificationTypeKey } from './notificationTypeRegistry';

/**
 * Phase 28 (Communications & Notifications). A code-defined registry —
 * not a Wix-backed, staff-editable collection — keyed by `notificationType`
 * **only**, never by `(notificationType, channel)`. Mirrors
 * `domain/documents/documentTypeRegistry.ts`/`domain/scheduling/appointmentTypeRegistry.ts`'s
 * registry convention, and borrows `domain/documents/mergeEngine.ts`'s
 * "never silently accept an unrecognized token" discipline for the small
 * token catalog below — but deliberately does not reuse the merge engine
 * itself, whose token catalog (financial totals, organization branding)
 * doesn't apply to a short, transient notification line.
 *
 * **Templates produce structured, channel-agnostic content; channels
 * decide formatting.** `resolveNotificationContent()` returns a plain
 * `{ title, body, actionUrl }` — `services/notifications/emailChannel.ts`
 * turns that into a subject + HTML body; `services/notifications/inAppChannel.ts`
 * stores it verbatim. Neither channel is referenced here.
 *
 * A future staff-editable, Wix-backed template override is a named,
 * reserved extension point — not built this phase.
 */
export type NotificationContent = {
  title: string;
  body: string;
  actionUrl: string | null;
};

/** The complete set of tokens any template below may reference. A
    template string referencing anything outside this set fails a unit
    test (see `notificationTemplateRegistry.test.ts`) — the same
    "recognized identifiers only" discipline `mergeEngine.ts`'s own token
    catalog enforces. A recognized token simply absent from a given call's
    `tokens` resolves to an empty string — acceptable here since these are
    short, transient lines, never a legally significant document. */
export type NotificationTokens = {
  recipientDisplayName?: string;
  actorDisplayName?: string;
  caseNumber?: string;
  decedentName?: string;
  entityTitle?: string; // e.g. an appointment's title, a task's text, a document's file name
};

const RECOGNIZED_TOKENS: readonly (keyof NotificationTokens)[] = ['recipientDisplayName', 'actorDisplayName', 'caseNumber', 'decedentName', 'entityTitle'];

type TemplateDefinition = {
  titleTemplate: string;
  bodyTemplate: string;
};

const NOTIFICATION_TEMPLATES: Record<string, TemplateDefinition> = {
  'scheduling.appointment_created': {
    titleTemplate: 'Appointment scheduled',
    bodyTemplate: '{{actorDisplayName}} scheduled "{{entityTitle}}"',
  },
  'scheduling.appointment_rescheduled': {
    titleTemplate: 'Appointment rescheduled',
    bodyTemplate: '{{actorDisplayName}} rescheduled "{{entityTitle}}"',
  },
  'scheduling.appointment_cancelled': {
    titleTemplate: 'Appointment cancelled',
    bodyTemplate: '{{actorDisplayName}} cancelled "{{entityTitle}}"',
  },
  'task.assigned': {
    titleTemplate: 'Task assigned',
    bodyTemplate: '{{actorDisplayName}} assigned you: "{{entityTitle}}"',
  },
  'signature.completed': {
    titleTemplate: 'Document signed',
    bodyTemplate: '{{entityTitle}} was signed for case {{caseNumber}} ({{decedentName}})',
  },
  'signature.declined': {
    titleTemplate: 'Signature declined',
    bodyTemplate: '{{entityTitle}} was declined for case {{caseNumber}} ({{decedentName}})',
  },
  'case.created': {
    titleTemplate: 'New case',
    bodyTemplate: 'A new case was created: {{decedentName}} ({{caseNumber}})',
  },
  'document.generated': {
    titleTemplate: 'Document generated',
    bodyTemplate: '{{entityTitle}} was generated for case {{caseNumber}}',
  },
  'payment.received': {
    titleTemplate: 'Payment received',
    bodyTemplate: 'A payment was received for case {{caseNumber}}',
  },
  'organization.member_joined': {
    titleTemplate: 'Team member joined',
    bodyTemplate: '{{entityTitle}} joined the organization',
  },
  'system.announcement': {
    titleTemplate: 'Announcement',
    bodyTemplate: '{{entityTitle}}',
  },

  // Phase 29 (Family Portal & External Collaboration). Delivered via
  // recipientScope: 'portal_user' only — see types/notification.ts.
  'family.document_ready': {
    titleTemplate: 'Document ready',
    bodyTemplate: '{{entityTitle}} is ready to view for case {{caseNumber}}',
  },
  'family.signature_requested': {
    titleTemplate: 'Signature requested',
    bodyTemplate: '{{entityTitle}} is ready for your signature for case {{caseNumber}}',
  },
  'family.appointment_reminder': {
    titleTemplate: 'Upcoming appointment',
    bodyTemplate: 'Reminder: {{entityTitle}} for case {{caseNumber}}',
  },
  'family.payment_reminder': {
    titleTemplate: 'Payment reminder',
    bodyTemplate: 'A balance is due for case {{caseNumber}}',
  },
  'family.message_received': {
    titleTemplate: 'New message',
    bodyTemplate: '{{actorDisplayName}} sent a message about case {{caseNumber}}',
  },
  'family.general_update': {
    titleTemplate: 'Case update',
    bodyTemplate: '{{entityTitle}}',
  },
  'portal.staff_message_received': {
    titleTemplate: 'New Family Portal message',
    bodyTemplate: '{{actorDisplayName}} sent a message about case {{caseNumber}}',
  },
};

function assertOnlyRecognizedTokens(template: string): void {
  const referenced = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  for (const token of referenced) {
    if (!RECOGNIZED_TOKENS.includes(token as keyof NotificationTokens)) {
      throw new Error(`Notification template references an unrecognized token: "${token}".`);
    }
  }
}

function interpolate(template: string, tokens: NotificationTokens): string {
  assertOnlyRecognizedTokens(template);
  return template.replace(/\{\{(\w+)\}\}/g, (_match, token: keyof NotificationTokens) => tokens[token] ?? '');
}

/** Resolves a `notificationType` + token set into channel-agnostic
    structured content. Throws if `notificationType` isn't a real
    registry entry — mirrors every other "validate at the service
    boundary" convention in this codebase. */
export function resolveNotificationContent(notificationType: string, tokens: NotificationTokens, actionUrl: string | null = null): NotificationContent {
  if (!isValidNotificationTypeKey(notificationType)) {
    throw new Error(`Unrecognized notification type: "${notificationType}".`);
  }
  const definition = NOTIFICATION_TEMPLATES[notificationType];
  if (!definition) {
    throw new Error(`No template registered for notification type: "${notificationType}".`);
  }
  return {
    title: interpolate(definition.titleTemplate, tokens),
    body: interpolate(definition.bodyTemplate, tokens),
    actionUrl,
  };
}
