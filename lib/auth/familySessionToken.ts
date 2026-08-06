import type { FamilySessionPayload } from '../../types/familyAuthSession';
import { getSessionSecret } from '../env';

/**
 * Phase 29 (Family Portal & External Collaboration). A signed,
 * self-contained family session token — the value stored in the
 * `beacon_family_session` cookie. Deliberately a fully independent,
 * self-contained module: it duplicates `lib/auth/sessionToken.ts`'s
 * algorithmic pattern (Web Crypto HMAC-SHA256, edge-safe, same
 * `<base64url(payload)>.<base64url(signature)>` shape) rather than
 * importing anything from it — refinement #4's "reuse only the
 * mechanism, never the cookie name, key, or shared state." See
 * `lib/auth/sessionIsolation.test.ts` for the structural proof that a
 * valid token from one system is always rejected by the other's verifier.
 */

export const FAMILY_SESSION_COOKIE_NAME = 'beacon_family_session';

// No "remember device" tier exists on the family side (unlike
// IdentitySession's 1h/30d split) — a single, longer-lived duration,
// since family members are occasional, not daily, visitors.
const FAMILY_SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days

const FAMILY_TOKEN_AUDIENCE = 'family' as const;

/** A fixed, namespaced context string HMAC'd together with the shared
    SESSION_JWT_SECRET to derive a signing key that is cryptographically
    distinct from lib/auth/sessionToken.ts's own staff-session key — never
    the same key bytes, even though both ultimately trace back to the same
    configured secret. Satisfies refinement #4's "distinct signing-key
    derivation" without requiring a second, separately-configured env var. */
const FAMILY_KEY_DERIVATION_CONTEXT = 'beacon-family-portal-session-v1';

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

async function importFamilyHmacKey(): Promise<CryptoKey> {
  const rootKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const derivedKeyMaterial = new Uint8Array(
    await crypto.subtle.sign('HMAC', rootKey, new TextEncoder().encode(FAMILY_KEY_DERIVATION_CONTEXT)),
  );
  return crypto.subtle.importKey('raw', derivedKeyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function isValidFamilySessionShape(value: unknown): value is FamilySessionPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FamilySessionPayload>;
  return (
    typeof candidate.portalUserId === 'string' &&
    typeof candidate.sessionId === 'string' &&
    candidate.aud === FAMILY_TOKEN_AUDIENCE &&
    typeof candidate.issuedAt === 'number' &&
    typeof candidate.expiresAt === 'number'
  );
}

/** Builds a fresh, signed family session token, always carrying a
    `sessionId` (unlike sessionToken.ts's optional one) — a family session
    always has a corresponding `PortalSession` registry row from the
    moment it's minted. */
export async function createFamilySessionToken(
  params: { portalUserId: string; sessionId: string },
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: FamilySessionPayload = {
    portalUserId: params.portalUserId,
    sessionId: params.sessionId,
    aud: FAMILY_TOKEN_AUDIENCE,
    issuedAt: now,
    expiresAt: now + FAMILY_SESSION_DURATION_SECONDS,
  };

  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importFamilyHmacKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  const signaturePart = base64UrlEncode(new Uint8Array(signature));

  return `${payloadPart}.${signaturePart}`;
}

/** Verifies a family session token's signature, audience claim, and
    expiry. Returns null for anything invalid — malformed, tampered,
    wrong audience, or expired — never throws, mirroring
    verifySessionToken's own "never distinguish why" posture. */
export async function verifyFamilySessionToken(
  token: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<FamilySessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;

  try {
    const key = await importFamilyHmacKey();
    const isValidSignature = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signaturePart).buffer as ArrayBuffer,
      new TextEncoder().encode(payloadPart),
    );
    if (!isValidSignature) return null;

    const payload: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    if (!isValidFamilySessionShape(payload)) return null;
    if (payload.aud !== FAMILY_TOKEN_AUDIENCE) return null;
    if (payload.expiresAt < now) return null;

    return payload;
  } catch {
    return null;
  }
}
