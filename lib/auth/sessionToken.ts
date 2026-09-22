import type { AuthSession } from '../../types/auth';
import { getSessionSecret } from '../env';

/**
 * Phase 13 (Authentication & Organizations). A signed, self-contained
 * session token — the value stored in Solis's httpOnly session cookie
 * (see lib/auth/session.ts). Built on Web Crypto (crypto.subtle), not
 * Node's `crypto` module, deliberately: this makes it work unchanged in
 * both `middleware.ts` (edge runtime, no Node crypto) and ordinary Server
 * Actions/Route Handlers (Node runtime) with one implementation, no
 * runtime-specific branching.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 signature)>` —
 * intentionally similar to a JWT in shape, but hand-rolled rather than
 * pulling in a JWT library, since the only algorithm this needs is a
 * single HMAC signature over a small, fixed payload shape.
 */

export const SESSION_COOKIE_NAME = 'beacon_session';

/**
 * Session-timeout investigation (2026-09). Root cause of "users logged out
 * while actively working": this token's `expiresAt` was a flat, absolute
 * 12-hour deadline from login, with no renewal of any kind — `createSession`
 * (the only writer of this token) was only ever called at explicit
 * login-type events, never on ongoing activity. A separate mechanism
 * *does* correctly implement sliding, activity-based expiry for
 * `'identity'`-mode sessions — the server-side `IdentitySession` registry
 * row (`services/sessionService.ts`'s `touchSession`, called on every
 * validated request via `lib/auth/resolveIdentitySession.ts`) — but that
 * inner sliding state could never rescue a session once this *outer*
 * token's own hard, non-renewing deadline passed, since `middleware.ts`
 * checks this token's embedded expiry first, on the edge, with no access
 * to the registry at all.
 *
 * Fix: for `'identity'`-mode sessions specifically (the only mode with
 * that registry-backed sliding backstop), this outer token's own absolute
 * ceiling is raised above the registry's own precise cutoff so the outer
 * token is never the thing that fires first. This token's ceiling is a
 * secondary, coarse "must fully re-authenticate at least this often"
 * backstop, not the primary expiry mechanism. `'mock'`/`'wix'` sessions
 * have no such registry to fall back on, so their duration is
 * deliberately left unchanged — widening their window would be a real,
 * uncompensated security regression for those modes.
 * See `lib/auth/requireIdentitySession.ts`/`requireAuthorizedOrganization.ts`
 * for the other half of this fix: both now also re-mint this token on
 * every successfully-validated Route Handler request, giving genuine
 * rolling renewal (not just a longer fixed ceiling) for the overwhelming
 * majority of real interactive traffic.
 *
 * Staff session policy correction (2026-09): the registry's own precise
 * cutoff (`services/sessionService.ts`) is now `min(lastSeenAt + 4h,
 * createdAt + 16h)` — a real, active-shift-length policy, not the coarse
 * "1h idle / 30d remembered" split this comment originally described.
 * This outer ceiling is tightened to match: 24 hours, comfortably above
 * the registry's own 16-hour absolute maximum (so the registry check —
 * the one with the precise, activity-aware logic — always fires first;
 * this token's own ceiling is never the actually-binding constraint), and
 * no longer a disconnected 30-day number that implied a much longer
 * effective session than the registry ever actually granted in practice.
 */
const DEFAULT_SESSION_DURATION_SECONDS = 60 * 60 * 12; // 12 hours — unchanged, mock/wix only
const IDENTITY_SESSION_DURATION_SECONDS = 60 * 60 * 24; // 24 hours — identity mode only; see comment above

export function sessionDurationSecondsFor(source: AuthSession['user']['source']): number {
  return source === 'identity' ? IDENTITY_SESSION_DURATION_SECONDS : DEFAULT_SESSION_DURATION_SECONDS;
}

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

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function isValidAuthSessionShape(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthSession>;
  return (
    typeof candidate.issuedAt === 'number' &&
    typeof candidate.expiresAt === 'number' &&
    !!candidate.user &&
    typeof candidate.user === 'object' &&
    typeof candidate.user.id === 'string' &&
    typeof candidate.user.email === 'string' &&
    typeof candidate.user.displayName === 'string' &&
    (candidate.user.source === 'mock' || candidate.user.source === 'wix' || candidate.user.source === 'identity') &&
    (candidate.sessionId === undefined || typeof candidate.sessionId === 'string')
  );
}

/** Builds a fresh, signed session token for a user, expiring
    `sessionDurationSecondsFor(user.source)` from now. `sessionId` (Phase 21)
    links an `'identity'`-source token to its server-side `IdentitySession`
    registry row — omitted entirely for `'mock'`/`'wix'` sessions, which
    have no such row. */
export async function createSessionToken(
  user: AuthSession['user'],
  now: number = Math.floor(Date.now() / 1000),
  sessionId?: string,
): Promise<string> {
  const payload: AuthSession = {
    user,
    issuedAt: now,
    expiresAt: now + sessionDurationSecondsFor(user.source),
    ...(sessionId ? { sessionId } : {}),
  };

  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(getSessionSecret());
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  const signaturePart = base64UrlEncode(new Uint8Array(signature));

  return `${payloadPart}.${signaturePart}`;
}

/**
 * Verifies a session token's signature and expiry. Returns null for
 * anything invalid — malformed, tampered, expired, or wrong shape — never
 * throws, so callers (middleware, layouts) can treat "no valid session"
 * uniformly regardless of *why* the token didn't check out. This is also
 * why session handling never logs the raw token or the reason a
 * particular one failed: "invalid" is the only signal that should ever
 * leave this function.
 */
export async function verifySessionToken(
  token: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<AuthSession | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;

  try {
    const key = await importHmacKey(getSessionSecret());
    const isValidSignature = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signaturePart).buffer as ArrayBuffer,
      new TextEncoder().encode(payloadPart),
    );
    if (!isValidSignature) return null;

    const payload: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    if (!isValidAuthSessionShape(payload)) return null;
    if (payload.expiresAt < now) return null;

    return payload;
  } catch {
    return null;
  }
}
