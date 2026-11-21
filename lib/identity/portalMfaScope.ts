import { createHash } from 'crypto';
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

export function portalMfaScopeId(env: Record<string, string | undefined> = process.env): string {
  const key = env.MFA_ENCRYPTION_KEY || (env.NODE_ENV === 'production' ? null : DEVELOPMENT_KEY);
  if (!key) throw new Error('MFA_ENCRYPTION_KEY is not set. A real, random 32-byte key is required in production.');
  return `portal-${createHash('sha256').update(`solis-portal-mfa-scope:${key}`).digest('hex').slice(0, 20)}`;
}
