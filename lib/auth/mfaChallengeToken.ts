import { getSessionSecret } from '../env';

/**
 * Phase 40 (MFA & Account Security). A signed, self-contained, SHORT-LIVED
 * "MFA challenge pending" token — the value stored in the `beacon_mfa_challenge`
 * cookie after a correct password but BEFORE the second factor is verified.
 *
 * CRITICAL AUTH BOUNDARY: this token is NOT a session. Possessing it grants
 * exactly one capability — to attempt the MFA challenge for one identity — and
 * nothing else. No protected route, no `getSession()` path, and no middleware
 * ever accepts it as authentication. A fully authenticated `IdentitySession`
 * is minted ONLY after the second factor verifies. This enforces the approved
 * rule: "password verification alone must not create a fully authenticated
 * session when MFA is required."
 *
 * Mirrors `lib/auth/familySessionToken.ts`'s edge-safe Web Crypto HMAC-SHA256
 * mechanism, but is cryptographically DISTINCT from both the staff session and
 * family session tokens: a different `aud` claim AND a different key-derivation
 * context, so a token from any other system is always rejected here and vice
 * versa (see `lib/auth/mfaChallengeIsolation.test.ts`).
 */
export const MFA_CHALLENGE_COOKIE_NAME = 'beacon_mfa_challenge';

/** Deliberately brief — a second factor should be entered promptly, and a
    stale pending-challenge should die on its own. */
const MFA_CHALLENGE_DURATION_SECONDS = 5 * 60; // 5 minutes

const MFA_CHALLENGE_AUDIENCE = 'mfa_challenge' as const;

const MFA_CHALLENGE_KEY_DERIVATION_CONTEXT = 'beacon-mfa-challenge-v1';

export type MfaChallengePayload = {
  identityId: string;
  aud: typeof MFA_CHALLENGE_AUDIENCE;
  /** Binds the pending challenge to the credential state at password-check
      time — if the password changes mid-challenge, this stale token is
      rejected. */
  passwordVersionAtIssue: number;
  /** Carried through so the eventual real session honors the login form's
      "remember this device" choice. */
  rememberDevice: boolean;
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

async function importMfaChallengeHmacKey(): Promise<CryptoKey> {
  const rootKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(getSessionSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derivedKeyMaterial = new Uint8Array(await crypto.subtle.sign('HMAC', rootKey, new TextEncoder().encode(MFA_CHALLENGE_KEY_DERIVATION_CONTEXT)));
  return crypto.subtle.importKey('raw', derivedKeyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function isValidShape(value: unknown): value is MfaChallengePayload {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<MfaChallengePayload>;
  return (
    typeof c.identityId === 'string' &&
    c.aud === MFA_CHALLENGE_AUDIENCE &&
    typeof c.passwordVersionAtIssue === 'number' &&
    typeof c.rememberDevice === 'boolean' &&
    typeof c.issuedAt === 'number' &&
    typeof c.expiresAt === 'number'
  );
}

export async function createMfaChallengeToken(
  params: { identityId: string; passwordVersionAtIssue: number; rememberDevice: boolean },
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: MfaChallengePayload = {
    identityId: params.identityId,
    aud: MFA_CHALLENGE_AUDIENCE,
    passwordVersionAtIssue: params.passwordVersionAtIssue,
    rememberDevice: params.rememberDevice,
    issuedAt: now,
    expiresAt: now + MFA_CHALLENGE_DURATION_SECONDS,
  };
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importMfaChallengeHmacKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  return `${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Verifies signature, audience, and expiry. Returns null for anything invalid
    — malformed, tampered, wrong audience, or expired — never throws. */
export async function verifyMfaChallengeToken(token: string, now: number = Math.floor(Date.now() / 1000)): Promise<MfaChallengePayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  try {
    const key = await importMfaChallengeHmacKey();
    const ok = await crypto.subtle.verify('HMAC', key, base64UrlDecode(signaturePart).buffer as ArrayBuffer, new TextEncoder().encode(payloadPart));
    if (!ok) return null;
    const payload: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    if (!isValidShape(payload)) return null;
    if (payload.aud !== MFA_CHALLENGE_AUDIENCE) return null;
    if (payload.expiresAt < now) return null;
    return payload;
  } catch {
    return null;
  }
}
