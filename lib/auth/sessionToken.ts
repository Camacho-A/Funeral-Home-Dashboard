import type { AuthSession } from '../../types/auth';
import { getSessionSecret } from '../env';

/**
 * Phase 13 (Authentication & Organizations). A signed, self-contained
 * session token — the value stored in Beacon's httpOnly session cookie
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

const SESSION_DURATION_SECONDS = 60 * 60 * 12; // 12 hours

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
    (candidate.user.source === 'mock' || candidate.user.source === 'wix')
  );
}

/** Builds a fresh, signed session token for a user, expiring
    SESSION_DURATION_SECONDS from now. */
export async function createSessionToken(
  user: AuthSession['user'],
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: AuthSession = {
    user,
    issuedAt: now,
    expiresAt: now + SESSION_DURATION_SECONDS,
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
