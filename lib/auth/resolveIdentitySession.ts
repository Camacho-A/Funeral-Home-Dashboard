import type { AuthSession } from '../../types/auth';
import type { IdentitySession } from '../../types/identitySession';
import type { Identity } from '../../types/identity';
import type { DataAdapterMode } from '../env';
import { getSessionById, touchSession } from '../../services/sessionService';
import { getIdentityById } from '../../services/identityService';

/**
 * Phase 21 (Identity, Authentication & Session Management). The
 * identity-mode sibling of nothing that existed before this phase — `'mock'`
 * and `'wix'` sessions have no server-side registry to re-validate against,
 * so this function only ever runs for `session.user.source === 'identity'`.
 *
 * The signed cookie (verified by lib/auth/sessionToken.ts, already done by
 * the time this runs) only proves the token was validly issued and hasn't
 * hit its own hard expiry. This function proves the *specific session it
 * points at* hasn't been revoked, hasn't slid past its own expiry, and was
 * issued under the identity's still-current password — the three things a
 * stateless token alone can never answer. See types/identitySession.ts's
 * own comment for why both checks exist side by side.
 *
 * On success, slides the session's expiration forward (touchSession) — this
 * is the only place that happens, so a rejected session is never
 * accidentally extended.
 */
export type ResolveIdentitySessionResult =
  | { valid: true; identity: Identity; identitySession: IdentitySession }
  | {
      valid: false;
      reason: 'missing_session_id' | 'session_not_found' | 'revoked' | 'expired' | 'password_changed' | 'identity_not_found' | 'identity_not_active';
    };

export async function resolveIdentitySession(
  session: AuthSession,
  dataAdapterMode: DataAdapterMode,
): Promise<ResolveIdentitySessionResult> {
  if (!session.sessionId) {
    return { valid: false, reason: 'missing_session_id' };
  }

  const identitySession = await getSessionById(session.sessionId, dataAdapterMode);
  if (!identitySession) {
    return { valid: false, reason: 'session_not_found' };
  }
  if (identitySession.revokedAt !== null) {
    return { valid: false, reason: 'revoked' };
  }
  if (new Date(identitySession.expiresAt).getTime() < Date.now()) {
    return { valid: false, reason: 'expired' };
  }

  const identity = await getIdentityById(identitySession.identityId, dataAdapterMode);
  if (!identity) {
    return { valid: false, reason: 'identity_not_found' };
  }
  if (identitySession.passwordVersionAtIssue !== identity.passwordVersion) {
    return { valid: false, reason: 'password_changed' };
  }
  if (identity.status !== 'active') {
    return { valid: false, reason: 'identity_not_active' };
  }

  await touchSession(identitySession.id, dataAdapterMode);

  return { valid: true, identity, identitySession };
}
