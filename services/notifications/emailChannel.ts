import type { NotificationContent } from '../../domain/notifications/notificationTemplateRegistry';

/**
 * Phase 28 (Communications & Notifications). A provider-neutral
 * `EmailProvider` interface, mirroring `lib/identity/messageSender.ts`'s
 * own dev-console/prod-throw posture exactly — deliberately never
 * imported from there directly, since `IdentityMessageSender`'s
 * `kind`-union serves mandatory, unpreferenced identity/security flows,
 * not preference-respecting staff notifications (see
 * docs/adr/ADR-032-communications-and-notifications.md's own stated
 * scope boundary).
 *
 * **Channels decide formatting, templates don't** — this file is the one
 * place `NotificationContent` (title/body/actionUrl) becomes an actual
 * email subject + body; `domain/notifications/notificationTemplateRegistry.ts`
 * never knows this module exists.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

function formatEmailMessage(to: string, content: NotificationContent): EmailMessage {
  const actionLine = content.actionUrl ? `\n\n${content.actionUrl}` : '';
  return {
    to,
    subject: content.title,
    bodyHtml: `<p>${content.body}</p>${content.actionUrl ? `<p><a href="${content.actionUrl}">View</a></p>` : ''}`,
    bodyText: `${content.body}${actionLine}`,
  };
}

/** Development-only delivery: logs to the server's own console — never a
    real inbox. Refuses to run at all outside development, the same
    independent-guard posture `consoleIdentityMessageSender` already
    established. */
export const consoleEmailProvider: EmailProvider = {
  async send(message) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('consoleEmailProvider must never run when NODE_ENV=production.');
    }
    console.log(`[dev-only, never sent to a real inbox] EmailMessage: ${JSON.stringify(message)}`);
  },
};

/** The production default: this codebase has no transactional email
    provider wired up for notifications either (matching
    `productionUnconfiguredIdentityMessageSender`'s own gap and posture
    exactly). Sending always fails loudly and explicitly — never a silent
    no-op — so whoever operates a production deployment notices and wires
    up a real provider rather than a slow leak of "notifications just
    don't seem to send." */
export const productionUnconfiguredEmailProvider: EmailProvider = {
  async send() {
    throw new Error(
      'No email provider is configured for production. Beacon has no transactional email ' +
        'integration yet — wire one up and provide a real EmailProvider before relying on email ' +
        'notification delivery in production.',
    );
  },
};

/** The one place environment decides which adapter is used — mirrors
    `getIdentityMessageSender()` exactly. Test files mock this module to
    inject a capturing provider instead. */
export function getEmailProvider(): EmailProvider {
  if (process.env.NODE_ENV === 'production') {
    return productionUnconfiguredEmailProvider;
  }
  return consoleEmailProvider;
}

/** Formats `NotificationContent` into an email and sends it via whichever
    `EmailProvider` the environment selects. The one function
    `services/notificationService.ts` calls for the email channel — it
    never constructs an `EmailMessage` or picks a provider itself. */
export async function sendEmailNotification(to: string, content: NotificationContent): Promise<void> {
  const provider = getEmailProvider();
  await provider.send(formatEmailMessage(to, content));
}
