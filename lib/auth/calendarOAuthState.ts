import { createHmac, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { getSessionSecret } from '../env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). The OAuth `state`/PKCE mechanism carrying context across
 * the redirect to Google/Microsoft and back — the equivalent of
 * `requireSameOrigin` for the one class of route that is genuinely,
 * legitimately cross-origin (the provider's own redirect back to
 * Beacon), mirroring `app/api/webhooks/clover/route.ts`'s own
 * "substitute a purpose-built authenticity check for the origin check"
 * precedent (there: an HMAC webhook signature; here: a signed,
 * single-use, short-lived state cookie).
 *
 * Signed with the same `SESSION_JWT_SECRET` (`getSessionSecret()`)
 * every staff session cookie is already signed with — this is
 * short-lived, low-sensitivity transient state (10-minute TTL, never a
 * long-term secret), so reusing the codebase's one already-trusted
 * signing key is reasonable rather than provisioning a dedicated one
 * for a value this narrow-purpose.
 *
 * `timingSafeEqual` with an explicit length check first — it throws on
 * a length mismatch rather than returning false — mirrors
 * `lib/clover/cloverWebhook.ts#verifyCloverSignature`'s exact idiom.
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes — generous for a redirect round trip, short enough to bound replay risk

/** The cookie the "start" route sets and the "callback" route reads back
    — carries the signed value from signOAuthStateCookie, never a raw
    state/PKCE value. `oauthStateCookieOptions()` mirrors
    `lib/auth/session.ts#cookieOptions()`'s exact shape (httpOnly,
    prod-only `secure`, `sameSite: 'lax'`), with `maxAge` matched to
    `TTL_MS` above so the cookie never outlives the signed value it
    carries. */
export const OAUTH_STATE_COOKIE_NAME = 'beacon_calendar_oauth_state';

export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: TTL_MS / 1000,
  };
}

export type CalendarOAuthStatePayload = {
  state: string;
  codeVerifier: string;
  organizationId: string;
  staffProfileId: string;
  provider: 'google' | 'microsoft';
  issuedAt: number;
};

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function generateOAuthState(): string {
  return randomBytes(24).toString('base64url');
}

/** The signed cookie value set on the "start" response and read back on
    the "callback" response — never the value Google/Microsoft see
    directly beyond the opaque `state` string embedded in it. */
export function signOAuthStateCookie(payload: Omit<CalendarOAuthStatePayload, 'issuedAt'>): string {
  const full: CalendarOAuthStatePayload = { ...payload, issuedAt: Date.now() };
  const encoded = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const signature = createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

/** Verifies the cookie's signature, expiry, and that its embedded
    `state` matches the `state` query parameter Google/Microsoft
    echoed back — the actual CSRF check. Returns `null` for any
    failure (tampered, expired, mismatched, malformed) — deliberately
    never distinguishes why, mirroring `verifySessionToken`'s own
    "any failure looks identical" posture. */
export function verifyOAuthStateCookie(cookieValue: string | undefined, expectedState: string): CalendarOAuthStatePayload | null {
  if (!cookieValue) return null;
  const [encoded, signature] = cookieValue.split('.');
  if (!encoded || !signature) return null;

  const expectedSignatureHex = createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  const expectedBuf = Buffer.from(expectedSignatureHex, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;

  let payload: CalendarOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (payload.state !== expectedState) return null;
  if (Date.now() - payload.issuedAt > TTL_MS) return null;
  return payload;
}
