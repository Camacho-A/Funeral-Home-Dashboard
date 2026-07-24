import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Verifies Clover's
 * `Clover-Signature: t=<unix-seconds>,v1=<hex-hmac>` header — confirmed
 * from docs.clover.com/dev/docs/ecomm-hosted-checkout-webhook. The
 * signed string is `${t}.${rawBody}`, HMAC-SHA256'd with the webhook
 * signing secret; `v1` is the resulting hex digest.
 *
 * Verification runs against the *raw* request body string, never a
 * parsed-then-re-serialized one — re-serializing JSON can reorder keys or
 * change whitespace, which would silently break a byte-exact HMAC check.
 * See app/api/webhooks/clover/route.ts's own comment on why it reads
 * `request.text()`, never `request.json()`, before verifying.
 *
 * Clover's own documentation does not specify a timestamp-tolerance
 * window. This applies a conservative 5-minute one — the same tolerance
 * Stripe's near-identical `t=...,v1=...` scheme (which Clover's format is
 * evidently modeled on) documents and recommends — to reject a replayed
 * old signature while tolerating reasonable clock drift/delivery lag. See
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md.
 */

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export type SignatureVerificationResult = { valid: true } | { valid: false; reason: string };

function parseSignatureHeader(header: string): { timestamp: string; signature: string } | null {
  const parts = new Map<string, string>();
  for (const segment of header.split(',')) {
    const [key, value] = segment.split('=');
    if (key && value) parts.set(key.trim(), value.trim());
  }
  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (!timestamp || !signature) return null;
  return { timestamp, signature };
}

export function verifyCloverSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureVerificationResult {
  if (!signatureHeader) {
    return { valid: false, reason: 'Missing Clover-Signature header.' };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { valid: false, reason: 'Malformed Clover-Signature header.' };
  }

  const timestamp = Number(parsed.timestamp);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'Malformed Clover-Signature timestamp.' };
  }
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return { valid: false, reason: 'Clover-Signature timestamp is outside the allowed tolerance.' };
  }

  const expectedHex = createHmac('sha256', webhookSecret).update(`${parsed.timestamp}.${rawBody}`).digest('hex');
  const expected = Buffer.from(expectedHex, 'utf8');
  const actual = Buffer.from(parsed.signature, 'utf8');

  // timingSafeEqual throws on a length mismatch rather than returning
  // false — checked explicitly first so a differently-sized (forged or
  // corrupted) signature is rejected the same way a wrong one is, never
  // an unhandled exception.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { valid: false, reason: 'Signature does not match.' };
  }

  return { valid: true };
}
