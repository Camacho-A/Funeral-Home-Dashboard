/**
 * Phase 19A (Secure Payment Architecture). The one canonical list of
 * literal field names that must never appear in any request body Beacon
 * accepts — a raw PAN, expiration, or CVV, however named. Server-side
 * enforcement (this file) is the mandatory backstop the phase's own
 * instructions call for: "do not rely on client validation." Reused by
 * both case Route Handlers (app/api/cases/route.ts, .../[caseId]/route.ts)
 * and the workflow-template version endpoint
 * (app/api/workflow-templates/[templateId]/versions/route.ts, via
 * lib/wixWorkflowTemplateMapper.ts's validateIntakeFieldPayload) — one
 * list, not re-typed at each call site. See
 * docs/adr/ADR-021-secure-payment-architecture.md.
 *
 * Deliberately a flat literal-key check, not a content scan of every
 * string value in a request (e.g. "does this string look like 16 digits?")
 * — that would risk false positives against legitimate data (a long
 * reference number, a phone number) and false confidence (a scan is easy
 * to defeat by reformatting). The real protection is architectural:
 * payment values never enter `draft`/`fieldValues` in the first place
 * (domain/workflow/resolveIntake.ts's own explicit skip) — this guard is a
 * second, independent layer against a forged request that names these
 * fields directly, not the only layer.
 */
export const FORBIDDEN_PAYMENT_FIELD_KEYS = [
  'cardNumber',
  'cardExp',
  'cardExpiration',
  'cardCvv',
  'cvv',
  'cardholderName',
  'billingZip',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns which forbidden keys (if any) are present as *direct* properties
 * of `body` — a shallow check by design, run against every distinct object
 * a request could smuggle payment data through (the top-level body, and
 * for case updates, the nested `patch` object). Returns an empty array for
 * anything that isn't a plain object at all, so callers can pass an
 * already-invalid body through without a separate type guard.
 */
export function findForbiddenPaymentFields(body: unknown): string[] {
  if (!isPlainObject(body)) return [];
  return FORBIDDEN_PAYMENT_FIELD_KEYS.filter((key) => key in body);
}
