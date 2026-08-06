import type { FamilySessionPayload } from '../../types/familyAuthSession';
import type { PortalSession } from '../../types/portalSession';
import type { PortalUser } from '../../types/portalUser';
import type { DataAdapterMode } from '../env';
import { getSessionById, touchSession } from '../../services/portal/portalSessionService';
import { getPortalUserById } from '../../services/portal/portalUserService';

/**
 * Phase 29 (Family Portal & External Collaboration). The `resolveIdentitySession.ts`
 * sibling for the family side — deliberately a fully separate module,
 * never importing from or imported by `resolveIdentitySession.ts` (see
 * `lib/auth/sessionIsolation.test.ts`).
 *
 * The signed cookie (verified by `familySessionToken.ts`, already done by
 * the time this runs) only proves the token was validly issued and hasn't
 * hit its own hard expiry. This function proves the *specific
 * `PortalSession` it points at* hasn't been revoked or slid past its own
 * expiry, and that the `PortalUser` it belongs to still exists and is
 * still `active` — the things a stateless token alone can never answer.
 *
 * On success, slides the session's expiration forward (touchSession) —
 * the only place that happens, so a rejected session is never
 * accidentally extended.
 */
export type ResolveFamilySessionResult =
  | { valid: true; portalUser: PortalUser; portalSession: PortalSession }
  | { valid: false; reason: 'session_not_found' | 'revoked' | 'expired' | 'portal_user_not_found' | 'portal_user_disabled' };

export async function resolveFamilySession(
  session: FamilySessionPayload,
  dataAdapterMode: DataAdapterMode,
): Promise<ResolveFamilySessionResult> {
  const portalSession = await getSessionById(session.sessionId, dataAdapterMode);
  if (!portalSession) {
    return { valid: false, reason: 'session_not_found' };
  }
  if (portalSession.revokedAt !== null) {
    return { valid: false, reason: 'revoked' };
  }
  if (new Date(portalSession.expiresAt).getTime() < Date.now()) {
    return { valid: false, reason: 'expired' };
  }

  const portalUser = await getPortalUserById(portalSession.portalUserId, dataAdapterMode);
  if (!portalUser) {
    return { valid: false, reason: 'portal_user_not_found' };
  }
  if (portalUser.status !== 'active') {
    return { valid: false, reason: 'portal_user_disabled' };
  }

  await touchSession(portalSession.id, dataAdapterMode);

  return { valid: true, portalUser, portalSession };
}
