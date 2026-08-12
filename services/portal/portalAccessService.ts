import type { DataAdapterMode } from '../../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../../lib/wixDataApi';
import {
  mapWixPortalAccessItem,
  buildWixPortalAccessData,
  applyPortalAccessUpdateToWixData,
  type WixPortalAccessItem,
} from '../../lib/wixPortalAccessMapper';
import type { PortalAccess } from '../../types/portalAccess';
import type { PortalRelationshipType } from '../../domain/portal/portalRelationshipRegistry';
import { hasPortalCapability, type PortalCapabilityKey } from '../../domain/portal/portalCapabilityPolicy';
import { portalAccessFixtures } from '../__mocks__/portalFixtures';

/**
 * Phase 29 (Family Portal & External Collaboration). The only writer of
 * the `portalAccess` collection — the *grant*. `createPendingPortalAccess`
 * is called exactly once, by `portalInvitationService.ts`, at invite time
 * (refinement #3/#5: the case and `relationshipType` a grant will confer
 * are fixed from the moment staff sends the invitation, never decided
 * later at acceptance). Every other transition here
 * (`activatePortalAccess`/`disablePortalAccess`/`revokePortalAccess`/
 * `expirePortalAccess`) only ever narrows or flips status — none can
 * expand what the row already says.
 *
 * `getPortalAccessForPortalUserAndCase` is the one lookup
 * `lib/auth/requireFamilyAccess.ts`'s resolution chain depends on —
 * looked up by `(portalUserId, caseId)`, never by a client-supplied
 * `organizationId` (refinement #1).
 */

function nowIso(): string {
  return new Date().toISOString();
}

export async function createPendingPortalAccess(
  params: {
    organizationId: string;
    caseId: string;
    relationshipType: PortalRelationshipType;
    grantedFromInvitationId: string;
    idFactory: () => string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<PortalAccess> {
  const now = nowIso();
  const access: PortalAccess = {
    id: params.idFactory(),
    portalUserId: null,
    organizationId: params.organizationId,
    caseId: params.caseId,
    relationshipType: params.relationshipType,
    status: 'pending',
    grantedFromInvitationId: params.grantedFromInvitationId,
    createdAt: now,
    updatedAt: now,
  };

  if (dataAdapterMode === 'mock') {
    portalAccessFixtures.push(access);
    return access;
  }

  const inserted = await insertWixDataItem<WixPortalAccessItem>('portalAccess', buildWixPortalAccessData(access), access.id);
  const mapped = mapWixPortalAccessItem(inserted.data);
  if (!mapped) throw new Error('Failed to create portal access grant.');
  return mapped;
}

export async function getPortalAccessById(accessId: string, dataAdapterMode: DataAdapterMode): Promise<PortalAccess | null> {
  if (dataAdapterMode === 'mock') {
    return portalAccessFixtures.find((a) => a.id === accessId) ?? null;
  }
  const response = await queryWixDataItems<WixPortalAccessItem>('portalAccess', {
    filter: { beaconPortalAccessId: accessId },
    paging: { limit: 1 },
  });
  return mapWixPortalAccessItem(response.dataItems[0]?.data);
}

/** The one lookup `requireFamilyAccess.ts` calls — never filtered by a
    client-supplied `organizationId`. `organizationId` is instead read
    back off the returned row itself (refinement #1). */
export async function getPortalAccessForPortalUserAndCase(
  portalUserId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalAccess | null> {
  if (dataAdapterMode === 'mock') {
    return portalAccessFixtures.find((a) => a.portalUserId === portalUserId && a.caseId === caseId) ?? null;
  }
  const response = await queryWixDataItems<WixPortalAccessItem>('portalAccess', {
    filter: { portalUserId, caseId },
    paging: { limit: 1 },
  });
  return mapWixPortalAccessItem(response.dataItems[0]?.data);
}

export async function listPortalAccessForCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<PortalAccess[]> {
  if (dataAdapterMode === 'mock') {
    return portalAccessFixtures.filter((a) => a.organizationId === organizationId && a.caseId === caseId);
  }
  const response = await queryWixDataItems<WixPortalAccessItem>('portalAccess', { filter: { organizationId, caseId } });
  return response.dataItems.map((item) => mapWixPortalAccessItem(item.data)).filter((a): a is PortalAccess => a !== null);
}

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Every currently-`active` `PortalAccess` grant for a case
 * that also carries a given capability — the resolution
 * `services/appointmentReminderService.ts` uses to fan family
 * appointment reminders out to every family member entitled to see
 * them (`capability: 'appointment.read'`), never inferred from a
 * display name/email and never assuming a single "primary" family
 * contact. A thin composition of the two existing primitives above —
 * `listPortalAccessForCase` (every grant, any status) filtered through
 * `hasPortalCapability` (fails closed for anything but `'active'`) —
 * deliberately not a new query shape.
 */
export async function listActiveAccessForCase(
  organizationId: string,
  caseId: string,
  capability: PortalCapabilityKey,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalAccess[]> {
  const grants = await listPortalAccessForCase(organizationId, caseId, dataAdapterMode);
  return grants.filter((grant) => hasPortalCapability(grant, capability));
}

/** Every case a given Portal User currently has *any* grant for (active or
    otherwise) — the basis for the family "my cases" list, which filters
    to `status === 'active'` itself rather than this function doing it. */
export async function listPortalAccessForPortalUser(portalUserId: string, dataAdapterMode: DataAdapterMode): Promise<PortalAccess[]> {
  if (dataAdapterMode === 'mock') {
    return portalAccessFixtures.filter((a) => a.portalUserId === portalUserId);
  }
  const response = await queryWixDataItems<WixPortalAccessItem>('portalAccess', { filter: { portalUserId } });
  return response.dataItems.map((item) => mapWixPortalAccessItem(item.data)).filter((a): a is PortalAccess => a !== null);
}

/** Resolves the one organization to attribute an org-required-but-not-
    inherently-scoped family action (login, the notification inbox) to —
    any one currently-`active` grant's organization. In practice a family
    member has grants in exactly one organization; a person with active
    grants across more than one is a named, accepted limitation (mirrors
    the plan's own "one person holding both a staff Membership and a
    PortalAccess is not designed for this phase"). Returns `null` when
    there is no active grant at all. */
export async function getPrimaryOrganizationIdForPortalUser(portalUserId: string, dataAdapterMode: DataAdapterMode): Promise<string | null> {
  const access = await listPortalAccessForPortalUser(portalUserId, dataAdapterMode);
  return access.find((a) => a.status === 'active')?.organizationId ?? null;
}

async function patchPortalAccess(accessId: string, patch: Partial<PortalAccess>, dataAdapterMode: DataAdapterMode): Promise<PortalAccess | null> {
  const nextPatch = { ...patch, updatedAt: nowIso() };

  if (dataAdapterMode === 'mock') {
    const index = portalAccessFixtures.findIndex((a) => a.id === accessId);
    if (index === -1) return null;
    portalAccessFixtures[index] = { ...portalAccessFixtures[index], ...nextPatch };
    return portalAccessFixtures[index];
  }

  const response = await queryWixDataItems<WixPortalAccessItem>('portalAccess', {
    filter: { beaconPortalAccessId: accessId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyPortalAccessUpdateToWixData(existingItem.data, nextPatch);
  const updated = await updateWixDataItem<WixPortalAccessItem>('portalAccess', existingItem.id, merged);
  return mapWixPortalAccessItem(updated.data);
}

/** `pending -> active` — the only place `portalUserId` is ever set. Called
    exactly once, by `portalInvitationService.ts`'s acceptance flow. Never
    called on a grant that isn't currently `pending` — the caller is
    expected to have already checked the linked invitation's own status. */
export async function activatePortalAccess(accessId: string, portalUserId: string, dataAdapterMode: DataAdapterMode): Promise<PortalAccess | null> {
  return patchPortalAccess(accessId, { status: 'active', portalUserId }, dataAdapterMode);
}

/** Staff action — reversible (unlike revoke, in spirit; both are
    fail-closed identically today, but `disabled` names a temporary
    suspension while `revoked` names a permanent one). */
export async function disablePortalAccess(accessId: string, dataAdapterMode: DataAdapterMode): Promise<PortalAccess | null> {
  return patchPortalAccess(accessId, { status: 'disabled' }, dataAdapterMode);
}

/** Staff action — permanent. */
export async function revokePortalAccess(accessId: string, dataAdapterMode: DataAdapterMode): Promise<PortalAccess | null> {
  return patchPortalAccess(accessId, { status: 'revoked' }, dataAdapterMode);
}

/** The linked invitation's token expired before it was ever accepted —
    called only by `portalInvitationService.ts`'s own expiry reconciliation,
    never by a staff action. */
export async function expirePortalAccess(accessId: string, dataAdapterMode: DataAdapterMode): Promise<PortalAccess | null> {
  return patchPortalAccess(accessId, { status: 'expired' }, dataAdapterMode);
}
