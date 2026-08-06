import type { DataAdapterMode } from '../../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../../lib/wixDataApi';
import {
  mapWixPortalInvitationItem,
  buildWixPortalInvitationData,
  applyPortalInvitationUpdateToWixData,
  type WixPortalInvitationItem,
} from '../../lib/wixPortalInvitationMapper';
import type { PortalInvitation } from '../../types/portalInvitation';
import type { PortalSession } from '../../types/portalSession';
import type { PortalUser } from '../../types/portalUser';
import type { PortalRelationshipType } from '../../domain/portal/portalRelationshipRegistry';
import { generateToken, hashToken } from '../../lib/identity/tokens';
import { hashPassword } from '../../lib/identity/passwordHashing';
import { createPendingPortalAccess, activatePortalAccess, expirePortalAccess, revokePortalAccess } from './portalAccessService';
import { findOrCreatePortalUser } from './portalUserService';
import { createPortalSession } from './portalSessionService';
import { portalActivityContext } from './portalActivityContext';
import { recordPortalInvited, recordPortalAccepted, recordPortalAccessRevoked, type ActivityContext } from '../activityService';
import { portalInvitationFixtures } from '../__mocks__/portalFixtures';

/**
 * Phase 29 (Family Portal & External Collaboration). The only writer of
 * the `portalInvitations` collection — the *offer* (see
 * `types/portalInvitation.ts`'s own header comment on why this is kept
 * separate from `PortalAccess`, the *grant* it produces).
 *
 * `issueInvitation` creates the linked `PortalAccess` row (via
 * `portalAccessService.createPendingPortalAccess`) in the same call —
 * refinement #3/#5: the case and `relationshipType` a grant will confer
 * are fixed from the moment staff sends the invitation, never decided at
 * acceptance time. `acceptInvitation` only ever **activates** that
 * already-fixed row; it can never expand its scope.
 *
 * `tokenHash` mirrors `services/signatureService.ts`'s own convention:
 * `generateToken()`/`hashToken()` from `lib/identity/tokens.ts`, the raw
 * token never persisted anywhere, existence-hiding on resolution (a
 * lookup failure, an expired token, and a wrong token are never
 * distinguished in the response).
 */
export class PortalInvitationServiceError extends Error {}

const INVITATION_EXPIRATION_DAYS = 14;

function nowIso(): string {
  return new Date().toISOString();
}

function defaultExpiresAt(fromIso: string): string {
  const date = new Date(fromIso);
  date.setUTCDate(date.getUTCDate() + INVITATION_EXPIRATION_DAYS);
  return date.toISOString();
}

async function persistInvitation(invitation: PortalInvitation, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    portalInvitationFixtures.push(invitation);
    return;
  }
  await insertWixDataItem<WixPortalInvitationItem>('portalInvitations', buildWixPortalInvitationData(invitation), invitation.id);
}

async function patchInvitation(
  invitationId: string,
  patch: Partial<Omit<PortalInvitation, 'id'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalInvitation> {
  const nextPatch = { ...patch, updatedAt: nowIso() };

  if (dataAdapterMode === 'mock') {
    const index = portalInvitationFixtures.findIndex((i) => i.id === invitationId);
    if (index === -1) throw new PortalInvitationServiceError('Invitation not found.');
    portalInvitationFixtures[index] = { ...portalInvitationFixtures[index], ...nextPatch };
    return portalInvitationFixtures[index];
  }

  const response = await queryWixDataItems<WixPortalInvitationItem>('portalInvitations', {
    filter: { beaconPortalInvitationId: invitationId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new PortalInvitationServiceError('Invitation not found.');
  const merged = applyPortalInvitationUpdateToWixData(existingItem.data, nextPatch);
  const updated = await updateWixDataItem<WixPortalInvitationItem>('portalInvitations', existingItem.id, merged);
  const mapped = mapWixPortalInvitationItem(updated.data);
  if (!mapped) throw new PortalInvitationServiceError('Failed to update invitation.');
  return mapped;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listPendingInvitationsForCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<PortalInvitation[]> {
  if (dataAdapterMode === 'mock') {
    return portalInvitationFixtures.filter((i) => i.organizationId === organizationId && i.caseId === caseId && i.status === 'pending');
  }
  const response = await queryWixDataItems<WixPortalInvitationItem>('portalInvitations', { filter: { organizationId, caseId, status: 'pending' } });
  return response.dataItems.map((item) => mapWixPortalInvitationItem(item.data)).filter((i): i is PortalInvitation => i !== null);
}

export async function getInvitationById(organizationId: string, invitationId: string, dataAdapterMode: DataAdapterMode): Promise<PortalInvitation | null> {
  if (dataAdapterMode === 'mock') {
    return portalInvitationFixtures.find((i) => i.id === invitationId && i.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixPortalInvitationItem>('portalInvitations', {
    filter: { organizationId, beaconPortalInvitationId: invitationId },
    paging: { limit: 1 },
  });
  return mapWixPortalInvitationItem(response.dataItems[0]?.data);
}

/** The family acceptance surface's one and only authorization mechanism —
    mirrors `signatureService.ts`'s `resolveSigningToken` exactly: hash the
    raw token, look it up by the collection's unique `tokenHash` index,
    never distinguish "no such token" from "expired" from "wrong token" in
    the thrown message. Lazily treats an overdue `expiresAt` as expired
    immediately, regardless of whether a reconciliation job has updated
    the persisted `status` field yet. */
export async function resolveInvitationToken(rawToken: string, dataAdapterMode: DataAdapterMode): Promise<PortalInvitation> {
  const tokenHash = hashToken(rawToken);

  let invitation: PortalInvitation | null;
  if (dataAdapterMode === 'mock') {
    invitation = portalInvitationFixtures.find((i) => i.tokenHash === tokenHash) ?? null;
  } else {
    const response = await queryWixDataItems<WixPortalInvitationItem>('portalInvitations', { filter: { tokenHash }, paging: { limit: 1 } });
    invitation = mapWixPortalInvitationItem(response.dataItems[0]?.data);
  }

  if (!invitation) {
    throw new PortalInvitationServiceError('This invitation link is invalid or has expired.');
  }
  if (invitation.status === 'pending' && new Date(invitation.expiresAt).getTime() < Date.now()) {
    throw new PortalInvitationServiceError('This invitation link is invalid or has expired.');
  }
  return invitation;
}

// ---------------------------------------------------------------------------
// Staff-initiated actions
// ---------------------------------------------------------------------------

export async function issueInvitation(
  params: {
    organizationId: string;
    caseId: string;
    email: string;
    displayName: string;
    relationshipType: PortalRelationshipType;
    idFactory: () => string;
    now?: string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ invitation: PortalInvitation; rawToken: string }> {
  const now = params.now ?? nowIso();
  const invitationId = params.idFactory();

  // Created alongside the invitation, at invite time — refinement #3/#5:
  // the case and relationshipType this grant will confer are fixed from
  // the start, never decided at acceptance.
  const access = await createPendingPortalAccess(
    {
      organizationId: params.organizationId,
      caseId: params.caseId,
      relationshipType: params.relationshipType,
      grantedFromInvitationId: invitationId,
      idFactory: params.idFactory,
    },
    dataAdapterMode,
  );

  const { token, tokenHash } = generateToken();
  const invitation: PortalInvitation = {
    id: invitationId,
    organizationId: params.organizationId,
    caseId: params.caseId,
    email: params.email,
    displayName: params.displayName,
    relationshipType: params.relationshipType,
    status: 'pending',
    tokenHash,
    expiresAt: defaultExpiresAt(now),
    invitedByStaffIdentityId: ctx.actorIdentityId ?? '',
    linkedPortalAccessId: access.id,
    acceptedAt: null,
    revokedAt: null,
    revokedByStaffIdentityId: null,
    createdAt: now,
    updatedAt: now,
  };
  await persistInvitation(invitation, dataAdapterMode);

  try {
    await recordPortalInvited(ctx, params.caseId, invitation.id, params.email, params.relationshipType, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record portal.invited activity event:', error instanceof Error ? error.message : error);
  }

  return { invitation, rawToken: token };
}

/** Cancels a still-pending invitation and its linked (still-pending)
    `PortalAccess` grant together — an invitation that can never be
    accepted should never leave an orphaned grant behind it, even though
    that grant could never itself be activated without a valid invitation
    (refinement #1's `status === 'active'` check is the only thing
    `requireFamilyAccess.ts` trusts). Idempotent on an already-revoked
    invitation. Refuses to touch an already-accepted invitation — that is
    a different lifecycle entirely (`portalAccessService.disablePortalAccess`/
    `revokePortalAccess`, called directly on the now-active grant). */
export async function revokeInvitation(
  organizationId: string,
  invitationId: string,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalInvitation> {
  const invitation = await getInvitationById(organizationId, invitationId, dataAdapterMode);
  if (!invitation) {
    throw new PortalInvitationServiceError('Invitation not found.');
  }
  if (invitation.status === 'revoked') {
    return invitation;
  }
  if (invitation.status !== 'pending') {
    throw new PortalInvitationServiceError('This invitation can no longer be revoked.');
  }

  const updated = await patchInvitation(invitationId, { status: 'revoked', revokedAt: nowIso(), revokedByStaffIdentityId: ctx.actorIdentityId }, dataAdapterMode);
  await revokePortalAccess(invitation.linkedPortalAccessId, dataAdapterMode);

  try {
    await recordPortalAccessRevoked(ctx, invitation.caseId, invitation.linkedPortalAccessId, invitation.relationshipType, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record portal.access_revoked activity event:', error instanceof Error ? error.message : error);
  }

  return updated;
}

/** Reconciliation only — mirrors `signatureService.ts`'s
    `expireOverdueSignatureRequests`: no scheduler exists in this codebase
    to call this automatically. Flips any overdue `pending` invitation to
    `expired`, and its linked (still-pending) `PortalAccess` grant to
    `expired` too — the one explicit transition the plan's own state
    diagram names ("Pending -> Expired (the linked invitation's token
    expired before acceptance)"). The security-relevant check in
    `resolveInvitationToken` never depends on this having run. */
export async function expireOverduePortalInvitations(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const now = Date.now();
  const candidates =
    dataAdapterMode === 'mock'
      ? portalInvitationFixtures.filter((i) => i.organizationId === organizationId && i.status === 'pending')
      : (await queryWixDataItems<WixPortalInvitationItem>('portalInvitations', { filter: { organizationId, status: 'pending' } })).dataItems
          .map((item) => mapWixPortalInvitationItem(item.data))
          .filter((i): i is PortalInvitation => i !== null);

  let expiredCount = 0;
  for (const candidate of candidates) {
    if (new Date(candidate.expiresAt).getTime() >= now) continue;
    await patchInvitation(candidate.id, { status: 'expired' }, dataAdapterMode);
    await expirePortalAccess(candidate.linkedPortalAccessId, dataAdapterMode);
    expiredCount += 1;
  }
  return expiredCount;
}

// ---------------------------------------------------------------------------
// Family-initiated action (no Beacon staff session ever involved)
// ---------------------------------------------------------------------------

export type AcceptInvitationResult =
  | { success: true; portalUser: PortalUser; portalSession: PortalSession }
  | { success: false; reason: 'invalid_or_expired' | 'already_used' };

/**
 * "Verify token -> create/find PortalUser -> set password (new users
 * only) -> activate the linked PortalAccess -> mint a fresh PortalSession"
 * as one atomic-from-the-caller's-perspective operation. Never reuses or
 * extends an existing session (refinement #13) — a brand-new
 * `PortalSession` is always created here, even for an already-existing
 * `PortalUser` accepting a second invitation.
 */
export async function acceptInvitation(
  params: { token: string; password: string; deviceId: string; deviceName?: string | null; ipAddress?: string | null; userAgent?: string | null; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<AcceptInvitationResult> {
  let invitation: PortalInvitation;
  try {
    invitation = await resolveInvitationToken(params.token, dataAdapterMode);
  } catch {
    return { success: false, reason: 'invalid_or_expired' };
  }
  if (invitation.status !== 'pending') {
    return { success: false, reason: invitation.status === 'accepted' ? 'already_used' : 'invalid_or_expired' };
  }

  const { portalUser } = await findOrCreatePortalUser(
    { email: invitation.email, displayName: invitation.displayName, passwordHash: hashPassword(params.password), idFactory: params.idFactory },
    dataAdapterMode,
  );

  await activatePortalAccess(invitation.linkedPortalAccessId, portalUser.id, dataAdapterMode);
  const updatedInvitation = await patchInvitation(invitation.id, { status: 'accepted', acceptedAt: nowIso() }, dataAdapterMode);

  const portalSession = await createPortalSession(
    { portalUserId: portalUser.id, deviceId: params.deviceId, deviceName: params.deviceName, ipAddress: params.ipAddress, userAgent: params.userAgent, idFactory: params.idFactory },
    dataAdapterMode,
  );

  try {
    const ctx = portalActivityContext(invitation.organizationId, params.idFactory());
    await recordPortalAccepted(ctx, updatedInvitation.caseId, updatedInvitation.id, portalUser.id, updatedInvitation.relationshipType, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record portal.accepted activity event:', error instanceof Error ? error.message : error);
  }

  return { success: true, portalUser, portalSession };
}
