import { randomBytes, timingSafeEqual } from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { isPortalScopedMfa, portalCodeHash, portalMfaScopeId } from '../lib/identity/portalMfaScope';
import { claimSetupGrant, isSetupGrantClaimed, listSetupGrants, saveSetupGrant, type PortalMfaSetupGrant } from './portalMfaStore';
import { getMembership, isActiveMembership } from './membershipService';
import { getIdentityById } from './identityService';
import { getMfaState } from './mfaService';

/**
 * Portal-scoped MFA (Phase 5N follow-up, 2026-11). How someone already
 * protected by MFA through another SOLIS deployment (e.g. Manors
 * Production) enrolls in this portal WITHOUT a password-only sign-in and
 * WITHOUT touching their existing enrollment or recovery codes:
 *
 *   1. An administrator of one of their organizations — never the person
 *      themselves — issues a one-time setup code here (audited; the code
 *      is shown once, only its hash is stored, it expires in 30 minutes,
 *      and issuing a new one revokes any earlier unused one).
 *   2. The administrator gives it to them out of band (in person / phone).
 *   3. They sign in with their password, enter the code, and must enroll a
 *      new authenticator for this portal before doing anything else. They
 *      get this portal's own recovery codes.
 *
 * Their other portal keeps working exactly as before.
 */
export class PortalMfaSetupError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PortalMfaSetupError';
  }
}

export const SETUP_CODE_TTL_MS = 30 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function newCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function issuePortalMfaSetupCode(
  params: { actorIdentityId: string; organizationId: string; targetIdentityId: string; now?: string; idFactory: () => string },
  mode: DataAdapterMode,
): Promise<{ code: string; expiresAt: string; grant: PortalMfaSetupGrant; targetDisplayName: string | null }> {
  if (!isPortalScopedMfa()) throw new PortalMfaSetupError('One-time setup codes are only used by a portal with its own two-step verification.', 409);
  if (params.actorIdentityId === params.targetIdentityId) throw new PortalMfaSetupError('You cannot issue a setup code for yourself. Ask another administrator.', 403);
  const membership = await getMembership(params.targetIdentityId, params.organizationId, mode);
  if (!membership || !isActiveMembership(membership)) throw new PortalMfaSetupError('This person is not an active member of this organization.', 404);
  const target = await getIdentityById(params.targetIdentityId, mode);
  if (!target) throw new PortalMfaSetupError('This person is not an active member of this organization.', 404);
  const state = await getMfaState(target, mode);
  if (state.enabled) throw new PortalMfaSetupError('This person already uses two-step verification in this portal.', 409);
  if (!state.enrolledElsewhere) throw new PortalMfaSetupError('This person has no two-step verification from another portal. They can set it up here directly after signing in.', 409);

  const scopeId = portalMfaScopeId();
  const nowIso = params.now ?? new Date().toISOString();
  for (const earlier of await listSetupGrants(scopeId, params.targetIdentityId, mode)) {
    if (!earlier.usedAt && !earlier.revokedAt) await saveSetupGrant({ ...earlier, revokedAt: nowIso }, mode);
  }
  const code = newCode();
  const expiresAt = new Date(Date.parse(nowIso) + SETUP_CODE_TTL_MS).toISOString();
  const grant: PortalMfaSetupGrant = {
    kind: 'grant',
    id: params.idFactory(),
    scopeId,
    identityId: params.targetIdentityId,
    codeHash: portalCodeHash(normalize(code)),
    organizationId: params.organizationId,
    grantedBy: params.actorIdentityId,
    grantedAt: nowIso,
    expiresAt,
    usedAt: null,
    revokedAt: null,
  };
  await saveSetupGrant(grant, mode);
  return { code, expiresAt, grant, targetDisplayName: target.displayName ?? null };
}

/** Newest first: later grantedAt, then the larger id as a deterministic tie-break. */
const newestFirst = (a: PortalMfaSetupGrant, b: PortalMfaSetupGrant) => (a.grantedAt === b.grantedAt ? (a.id < b.id ? 1 : -1) : a.grantedAt < b.grantedAt ? 1 : -1);

/**
 * True (and the code is used up) only for this person's LATEST code in
 * this portal — the newest unrevoked grant, used or not — and only while
 * it is unused and unexpired. Once it is used or has expired, no older
 * code can take its place. If two administrators issue codes at the same moment, both
 * rows may survive the revoke-earlier step, but only the newer one can
 * ever be redeemed. Exactly one of any simultaneous redemptions can
 * succeed (claimSetupGrant).
 */
export async function redeemPortalMfaSetupCode(identityId: string, code: string, mode: DataAdapterMode, now: string = new Date().toISOString()): Promise<boolean> {
  if (!isPortalScopedMfa()) return false;
  const submitted = Buffer.from(portalCodeHash(normalize(code)));
  const grants = await listSetupGrants(portalMfaScopeId(), identityId, mode);
  // The newest unrevoked grant — used or not — is the only one that can ever count.
  const latest = grants.filter((g) => !g.revokedAt).sort(newestFirst)[0];
  if (!latest || latest.usedAt || Date.parse(latest.expiresAt) <= Date.parse(now)) return false;
  const stored = Buffer.from(latest.codeHash);
  if (stored.length !== submitted.length || !timingSafeEqual(stored, submitted)) return false;
  if (await isSetupGrantClaimed(latest.id, mode)) return false;
  if (!(await claimSetupGrant(latest, now, mode))) return false;
  await saveSetupGrant({ ...latest, usedAt: now }, mode);
  return true;
}
