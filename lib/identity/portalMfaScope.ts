import { createHash, createHmac } from 'crypto';
import { isGusDeployment } from '../gusDeployment';

/**
 * Portal-scoped MFA (Phase 5N follow-up, 2026-11). Identities are shared by
 * every SOLIS deployment, but each deployment encrypts authenticator secrets
 * with its OWN `MFA_ENCRYPTION_KEY`. The original MFA fields on the shared
 * identity record (`mfaEnabled`, `mfaSecretReference`, recovery-code hashes)
 * belong to the deployment that created them — Manors Production. A
 * portal-scoped deployment (the `gus-solis` portal, Gus-only or unified)
 * never reads or writes those fields: it keeps its own enrollments in a
 * separate store, keyed by this portal's scope id. So enrolling in the
 * unified portal can never overwrite or invalidate a Manors enrollment.
 *
 * The scope id is a one-way digest of this deployment's MFA key — stable
 * for the key's lifetime, different for every key, and reveals nothing
 * about it. Rotating the key starts a new scope (old ciphertext could not
 * be decrypted anyway), so staff re-enroll after a rotation.
 */
export function isPortalScopedMfa(env: Record<string, string | undefined> = process.env): boolean {
  return env.SOLIS_PORTAL_SCOPED_MFA === 'true' || isGusDeployment(env);
}

const DEVELOPMENT_KEY = 'beacon-development-only-insecure-mfa-key-do-not-use-in-production';

function portalKey(env: Record<string, string | undefined>): string {
  const key = env.MFA_ENCRYPTION_KEY || (env.NODE_ENV === 'production' ? null : DEVELOPMENT_KEY);
  if (!key) throw new Error('MFA_ENCRYPTION_KEY is not set. A real, random 32-byte key is required in production.');
  return key;
}

export function portalMfaScopeId(env: Record<string, string | undefined> = process.env): string {
  return `portal-${createHash('sha256').update(`solis-portal-mfa-scope:${portalKey(env)}`).digest('hex').slice(0, 20)}`;
}

/**
 * Keyed hash (HMAC-SHA-256) for this portal's recovery codes and one-time
 * setup codes. Only these hashes are stored. Keyed with a value derived
 * from this portal's MFA key, so a copy of the stored hashes alone cannot
 * be brute-forced offline (recovery codes are short by design). The key
 * itself is never stored; rotating it invalidates the hashes along with
 * the enrollments they belong to.
 */
export function portalCodeHash(code: string, env: Record<string, string | undefined> = process.env): string {
  const hmacKey = createHash('sha256').update(`solis-portal-mfa-code-hmac:${portalKey(env)}`).digest();
  return createHmac('sha256', hmacKey).update(code).digest('hex');
}
