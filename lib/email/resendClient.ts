/**
 * Phase 33 (Real Notification Delivery). Direct Resend REST API access
 * via `fetch` — same "thin, directly-testable wrapper, global `fetch`
 * stubbed in tests rather than a bespoke transport abstraction/SDK"
 * pattern `lib/clover/cloverClient.ts` already established for Clover.
 *
 * Unlike Clover's per-organization `PaymentIntegration` credential
 * indirection (`lib/clover/cloverConfig.ts`), Resend is a single,
 * platform-level provider — Solis sends transactional email on its own
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

import { isValidEmail } from '../../utils/inputMask';

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

/** Pulls just the email address out of a "from" value — either
    `Name <email>` or a bare `email`. Used so the display name below is
    never at the mercy of whatever happened to already be baked into
    `RESEND_FROM_ADDRESS`'s own configured value. */
function extractSenderEmail(fromValue: string): string {
  const match = fromValue.match(/<([^>]+)>/);
  return (match ? match[1] : fromValue).trim();
}

/** Display-name determinism fix (2026-10). `RESEND_FROM_ADDRESS` is
    still the one place the sending EMAIL ADDRESS comes from — this
    function never hardcodes or bypasses it, and the deliverability
    investigation already confirmed that domain is verified and passing
    DMARC. What changed: the DISPLAY NAME is no longer whatever happens
    to be configured inside that same env var — it's always, literally,
    "SOLIS", extracted and rebuilt here regardless of whether
    `RESEND_FROM_ADDRESS` is a bare address, already correctly says
    "SOLIS", or still carries an old/wrong display name (e.g. "Solis")
    from before this fix existed. That's what makes this deterministic:
    no possible value of `RESEND_FROM_ADDRESS` can ever produce anything
    but "SOLIS <that address>" — fixing it no longer requires editing
    the env var itself, only the actual email address portion if that
    ever needs to change. The literal fallback address below only ever
    applies when `RESEND_FROM_ADDRESS` is unset entirely (local/dev,
    where sends go through `consoleIdentityMessageSender` instead and
    this value is never actually used to send real mail). */
function getResendFromAddress(): string {
  const configured = process.env.RESEND_FROM_ADDRESS;
  const email = configured ? extractSenderEmail(configured) : 'notifications@beacon.app';
  return `SOLIS <${email}>`;
}

/** Reply-To (2026-10, invitation deliverability follow-up). A single,
    platform-level, optional value — mirrors `getResendFromAddress()`'s
    own "one configured value, not per-tenant/per-message" posture, since
    no existing organization-level or support-inbox concept already
    served this purpose (checked: no env var, no `Organization` field
    used for transactional-email infrastructure — `Organization.primaryEmail`
    is tenant business-profile data, editable per-org and often empty,
    not an ops-managed monitored inbox). Returns `undefined` — never an
    empty string — whenever the value is unset or not a well-formed
    email, so a malformed/missing `RESEND_REPLY_TO_ADDRESS` can never
    turn into a reason a send fails; `sendResendEmail` below simply omits
    `reply_to` from the request in that case. */
function getResendReplyToAddress(): string | undefined {
  const value = process.env.RESEND_REPLY_TO_ADDRESS;
  if (!value || !isValidEmail(value)) return undefined;
  return value;
}

export async function sendResendEmail(request: ResendEmailRequest): Promise<void> {
  const apiKey = getResendApiKey();
  const replyTo = getResendReplyToAddress();
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
      ...(replyTo ? { reply_to: replyTo } : {}),
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
