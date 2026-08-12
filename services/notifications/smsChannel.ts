import type { NotificationContent } from '../../domain/notifications/notificationTemplateRegistry';

/**
 * Phase 33 (Real Notification Delivery). A provider-neutral `SmsProvider`
 * interface, mirroring `emailChannel.ts`'s exact dev-console/prod-throw/
 * real-adapter shape end to end — the third and final channel this
 * codebase's dispatch loop understands (`in_app`/`email`/`sms`). See
 * docs/adr/ADR-037-real-notification-delivery.md.
 *
 * **Channels decide formatting, templates don't** — same rule
 * `emailChannel.ts` already established. SMS bodies are deliberately
 * plain text only, and short: no HTML, and `actionUrl` (if present) is
 * appended as a bare link rather than turned into markup, since SMS has
 * no rendering concept at all.
 */
export type SmsMessage = {
  to: string;
  body: string;
};

export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}

function formatSmsMessage(to: string, content: NotificationContent): SmsMessage {
  const actionLine = content.actionUrl ? ` ${content.actionUrl}` : '';
  return { to, body: `${content.title}: ${content.body}${actionLine}` };
}

/** Development-only delivery: logs to the server's own console — never a
    real phone. Refuses to run at all outside development, the same
    independent-guard posture `consoleEmailProvider` already established. */
export const consoleSmsProvider: SmsProvider = {
  async send(message) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('consoleSmsProvider must never run when NODE_ENV=production.');
    }
    console.log(`[dev-only, never sent to a real phone] SmsMessage: ${JSON.stringify(message)}`);
  },
};

/** The production default: sending always fails loudly and explicitly —
    never a silent no-op — matching `productionUnconfiguredEmailProvider`'s
    own posture exactly. */
export const productionUnconfiguredSmsProvider: SmsProvider = {
  async send() {
    throw new Error(
      'No SMS provider is configured for production. Beacon has no Twilio integration configured — ' +
        'wire one up (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER) and provide a real ' +
        'SmsProvider before relying on SMS notification delivery in production.',
    );
  },
};

export class TwilioApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TwilioApiError';
    this.status = status;
  }
}

function getTwilioCredentials(): { accountSid: string; authToken: string; fromNumber: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

/** The real, production-capable adapter — direct Twilio REST API access
    via `fetch` (no SDK), the same "thin, directly-testable wrapper"
    pattern `lib/clover/cloverClient.ts`/`lib/email/resendClient.ts`
    already established. */
export const twilioSmsProvider: SmsProvider = {
  async send(message) {
    const credentials = getTwilioCredentials();
    if (!credentials) {
      throw new Error('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER are not fully set.');
    }
    const { accountSid, authToken, fromNumber } = credentials;
    const body = new URLSearchParams({ To: message.to, From: fromNumber, Body: message.body });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new TwilioApiError(`Twilio send failed (HTTP ${response.status}).`, response.status);
    }
  },
};

/** Whether a real send should be attempted at all — mirrors
    `isResendConfigured()` exactly. */
export function isTwilioConfigured(): boolean {
  return getTwilioCredentials() !== null;
}

/** The one place environment decides which adapter is used — mirrors
    `getEmailProvider()` exactly, including "a fully configured provider
    wins regardless of NODE_ENV." */
export function getSmsProvider(): SmsProvider {
  if (isTwilioConfigured()) {
    return twilioSmsProvider;
  }
  if (process.env.NODE_ENV === 'production') {
    return productionUnconfiguredSmsProvider;
  }
  return consoleSmsProvider;
}

/** Formats `NotificationContent` into an SMS and sends it via whichever
    `SmsProvider` the environment selects — the one function
    `services/notificationService.ts` calls for the `sms` channel,
    mirroring `sendEmailNotification`'s exact role. */
export async function sendSmsNotification(to: string, content: NotificationContent): Promise<void> {
  const provider = getSmsProvider();
  await provider.send(formatSmsMessage(to, content));
}
