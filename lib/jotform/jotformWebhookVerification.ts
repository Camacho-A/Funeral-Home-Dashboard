import { timingSafeEqual } from 'crypto';

/**
 * Manors Jotform integration (case-first architecture, 2026-09).
 *
 * CORRECTED DESIGN (2026-09 pre-production hardening): this boundary
 * previously checked an `x-solis-webhook-secret` HTTP header. That
 * assumption was verified against a real, authenticated inspection of
 * this account's actual Jotform configuration surface and found
 * incorrect for the classic per-form Webhooks integration this
 * architecture uses — Jotform's classic Webhooks integration has no
 * documented custom-header capability; that capability exists only in
 * the separate "Jotform Workflows" product, which this integration
 * deliberately does NOT use (a different configuration surface, with an
 * unverified/likely-different outbound payload shape).
 *
 * The corrected mechanism: a shared secret carried as a hidden FORM
 * FIELD (`solisWebhookAuth`, see domain/externalForms/parseWebhookPayload.ts's
 * `extractWebhookAuthValue`) rather than an HTTP header — this works on
 * the classic Webhooks integration Jotform's own support documentation
 * recommends exactly this pattern as its standard workaround for webhook
 * authenticity, independent of this integration's own design.
 *
 * Deliberately a *shared secret*, not a payload-signing HMAC — simpler,
 * and sufficient as a stopgap specifically because it is fail-closed by
 * default (no secret configured = no request ever accepted) rather than
 * fail-open.
 *
 * `solisWebhookAuth` is completely independent from `solisLinkToken`
 * (types/caseFormLink.ts) — the auth value proves "this request came
 * through a Jotform form SOLIS configured," the link token proves "this
 * specific submission belongs to this specific Case/form slot." An
 * invalid or absent link token means the submission is authenticated but
 * unmatched (see the webhook route's own handling) — it is never treated
 * as an authentication failure. Regenerating a CaseFormLink's link token
 * never affects `solisWebhookAuth`, and vice versa.
 */
export type JotformWebhookVerificationResult = { valid: true } | { valid: false; reason: 'not_configured' | 'missing_field' | 'mismatch' };

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * `providedAuthValue` is the value already extracted from the request
 * body by `parseWebhookPayload.ts#extractWebhookAuthValue` — this
 * function never touches a `Request`/`Headers` object itself, and never
 * logs either its input or the configured secret in any branch.
 */
export function verifyJotformWebhook(providedAuthValue: string | null): JotformWebhookVerificationResult {
  const configuredSecret = process.env.JOTFORM_WEBHOOK_SHARED_SECRET;
  if (!configuredSecret) {
    return { valid: false, reason: 'not_configured' };
  }

  if (!providedAuthValue) {
    return { valid: false, reason: 'missing_field' };
  }

  if (!timingSafeStringEqual(providedAuthValue, configuredSecret)) {
    return { valid: false, reason: 'mismatch' };
  }

  return { valid: true };
}
