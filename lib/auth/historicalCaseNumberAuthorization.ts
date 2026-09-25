import { getSessionSecret } from '../env';

/**
 * Historical Arrangement import — case-number preservation (2026-09). A
 * signed, self-contained, SHORT-LIVED authorization minted by
 * `app/api/cases/historical-jotform-import/route.ts` immediately after it
 * has server-side-fetched and validated a historical Jotform submission
 * and derived its legitimate Manors case number
 * (domain/externalForms/historicalCaseNumber.ts). `POST /api/cases`
 * verifies this token before ever preserving that number instead of
 * calling `reserveNextCaseNumber` — this is the ONLY way `/api/cases` can
 * be told to skip normal allocation.
 *
 * Deliberately NOT a bare `historicalCaseNumber` body field on its own:
 * an authorized staff member's own permission alone doesn't prove a
 * number actually came from a real, fetched Jotform submission — only
 * the server code that just did that fetch can mint a token whose
 * signature verifies. A forged/replayed/stale/mismatched request is
 * rejected outright, never silently falls back to normal allocation
 * (which would be a confusing, unannounced substitution of a different
 * case number than the one staff expects).
 *
 * Mirrors `lib/auth/mfaChallengeToken.ts`'s edge-safe Web Crypto
 * HMAC-SHA256 mechanism exactly — reuses the existing `getSessionSecret()`
 * root secret via a fresh key-derivation context, so this introduces NO
 * new long-lived secret. Cryptographically distinct from every other
 * token minted off the same root secret (a different `aud` claim AND a
 * different derivation context — see `historicalCaseNumberAuthorization.test.ts`
 * for the cross-token isolation proof), so a token from any other system
 * is always rejected here and vice versa.
 */
const HISTORICAL_CASE_NUMBER_AUDIENCE = 'historical_case_number' as const;

/** Deliberately brief — this token is minted and consumed within the same
    logical operation (the historical-import route's own immediate
    follow-up call to POST /api/cases), never held or reused later. */
const HISTORICAL_CASE_NUMBER_DURATION_SECONDS = 5 * 60; // 5 minutes

const HISTORICAL_CASE_NUMBER_KEY_DERIVATION_CONTEXT = 'beacon-historical-case-number-v1';

export type HistoricalCaseNumberAuthorizationPayload = {
  organizationId: string;
  externalFormId: string;
  externalSubmissionId: string;
  caseNumber: string;
  aud: typeof HISTORICAL_CASE_NUMBER_AUDIENCE;
  issuedAt: number;
  expiresAt: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padLength = (4 - (value.length % 4)) % 4;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importHistoricalCaseNumberHmacKey(): Promise<CryptoKey> {
  const rootKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(getSessionSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derivedKeyMaterial = new Uint8Array(
    await crypto.subtle.sign('HMAC', rootKey, new TextEncoder().encode(HISTORICAL_CASE_NUMBER_KEY_DERIVATION_CONTEXT)),
  );
  return crypto.subtle.importKey('raw', derivedKeyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function isValidShape(value: unknown): value is HistoricalCaseNumberAuthorizationPayload {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<HistoricalCaseNumberAuthorizationPayload>;
  return (
    typeof c.organizationId === 'string' &&
    typeof c.externalFormId === 'string' &&
    typeof c.externalSubmissionId === 'string' &&
    typeof c.caseNumber === 'string' &&
    c.aud === HISTORICAL_CASE_NUMBER_AUDIENCE &&
    typeof c.issuedAt === 'number' &&
    typeof c.expiresAt === 'number'
  );
}

export async function createHistoricalCaseNumberAuthorization(
  params: { organizationId: string; externalFormId: string; externalSubmissionId: string; caseNumber: string },
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: HistoricalCaseNumberAuthorizationPayload = {
    organizationId: params.organizationId,
    externalFormId: params.externalFormId,
    externalSubmissionId: params.externalSubmissionId,
    caseNumber: params.caseNumber,
    aud: HISTORICAL_CASE_NUMBER_AUDIENCE,
    issuedAt: now,
    expiresAt: now + HISTORICAL_CASE_NUMBER_DURATION_SECONDS,
  };
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHistoricalCaseNumberHmacKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  return `${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Verifies signature, audience, and expiry only — returns the decoded
    payload for the CALLER to additionally match against its own trusted
    context (organizationId, the submitted caseNumber, etc. — see
    app/api/cases/route.ts). Returns null for anything invalid: malformed,
    tampered, wrong audience, or expired. Never throws. */
export async function verifyHistoricalCaseNumberAuthorization(
  token: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<HistoricalCaseNumberAuthorizationPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  try {
    const key = await importHistoricalCaseNumberHmacKey();
    const ok = await crypto.subtle.verify('HMAC', key, base64UrlDecode(signaturePart).buffer as ArrayBuffer, new TextEncoder().encode(payloadPart));
    if (!ok) return null;
    const payload: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    if (!isValidShape(payload)) return null;
    if (payload.aud !== HISTORICAL_CASE_NUMBER_AUDIENCE) return null;
    if (payload.expiresAt < now) return null;
    return payload;
  } catch {
    return null;
  }
}
