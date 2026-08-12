/**
 * Phase 33 (Real Notification Delivery). Direct Resend REST API access
 * via `fetch` — same "thin, directly-testable wrapper, global `fetch`
 * stubbed in tests rather than a bespoke transport abstraction/SDK"
 * pattern `lib/clover/cloverClient.ts` already established for Clover.
 *
 * Unlike Clover's per-organization `PaymentIntegration` credential
 * indirection (`lib/clover/cloverConfig.ts`), Resend is a single,
 * platform-level provider — Beacon sends transactional email on its own
 * behalf, not per-tenant merchant credentials — so `RESEND_API_KEY` is
 * read directly from `process.env` here, the simpler of this codebase's
 * two established env-var-reading shapes, not the reference-indirection
 * one Clover needs for a genuinely per-organization credential.
 *
 * This one client backs both `lib/identity/messageSender.ts`'s
 * `resendIdentityMessageSender` and
 * `services/notifications/emailChannel.ts`'s `resendEmailProvider` — one
 * real provider integration, two thin adapters, never two separate
 * provider integrations for the same underlying "send an email"
 * capability. See docs/adr/ADR-037-real-notification-delivery.md.
 */

export class ResendApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ResendApiError';
    this.status = status;
  }
}

export type ResendEmailRequest = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** Throws with a clear, actionable message naming the missing variable —
    never its (absent) content — matching `lib/env.ts`'s existing "fail
    clearly, never leak" convention. Callers (the two adapters above)
    only call this once they've already decided a real send should
    happen; this function itself never silently falls back to anything. */
function getResendApiKey(): string {
  const value = process.env.RESEND_API_KEY;
  if (!value) {
    throw new Error('RESEND_API_KEY is not set. Set it in .env.local (server-only), or use the console adapter until it is.');
  }
  return value;
}

/** The one "from" address every Resend-sent email uses — Resend requires
    a domain-verified sender, so this is deliberately a single configured
    value, never per-message-supplied. */
function getResendFromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS || 'Beacon <notifications@beacon.app>';
}

export async function sendResendEmail(request: ResendEmailRequest): Promise<void> {
  const apiKey = getResendApiKey();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: getResendFromAddress(),
      to: request.to,
      subject: request.subject,
      html: request.html,
      text: request.text,
    }),
  });

  if (!response.ok) {
    throw new ResendApiError(`Resend send failed (HTTP ${response.status}).`, response.status);
  }
}

/** Whether a real send should be attempted at all — the one place both
    adapters check this, so "is Resend configured" is never decided two
    different ways. */
export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
