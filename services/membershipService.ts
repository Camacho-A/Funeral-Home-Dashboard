import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixMembershipItem,
  buildWixMembershipData,
  applyMembershipUpdateToWixData,
  type WixMembershipItem,
} from '../lib/wixMembershipMapper';
import type { Membership } from '../types/membership';
import { membershipFixtures } from './__mocks__/identityFixtures';

/**
 * Phase 21 (Identity, Authentication & Session Management). Owns the
 * (identity-mode) `organizationMemberships` records exclusively — see
 * `types/membership.ts`'s own comment on why this coexists with, rather
 * than replaces, the pre-existing mock-fixture-based
 * `OrganizationMembership` model `AUTH_ADAPTER='mock'|'wix'` sessions keep
 * using. "Membership grants permissions. Identity never grants
 * permissions": every authorization decision for an identity-mode session
 * goes through this module, never `identityService.ts`.
 */
function nowIso(): string {
  return new Date().toISOString();
}

export async function getMembership(
  identityId: string,
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<Membership | null> {
  if (dataAdapterMode === 'mock') {
    return membershipFixtures.find((m) => m.identityId === identityId && m.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixMembershipItem>('organizationMemberships', {
    filter: { identityId, organizationId },
    paging: { limit: 1 },
  });
  return mapWixMembershipItem(response.dataItems[0]?.data);
}

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification).
 * Looks up a `Membership` by its own id — the shape `StaffProfile.membershipId`
 * needs, distinct from `getMembership`'s `(identityId, organizationId)`
 * lookup above (which is keyed by the *pair*, not a single row id).
 */
export async function getMembershipById(membershipId: string, dataAdapterMode: DataAdapterMode): Promise<Membership | null> {
  if (dataAdapterMode === 'mock') {
    return membershipFixtures.find((m) => m.id === membershipId) ?? null;
  }
  const response = await queryWixDataItems<WixMembershipItem>('organizationMemberships', {
    filter: { beaconMembershipId: membershipId },
    paging: { limit: 1 },
  });
  return mapWixMembershipItem(response.dataItems[0]?.data);
}

export async function listMembershipsForIdentity(identityId: string, dataAdapterMode: DataAdapterMode): Promise<Membership[]> {
  if (dataAdapterMode === 'mock') {
    return membershipFixtures.filter((m) => m.identityId === identityId);
  }
  const response = await queryWixDataItems<WixMembershipItem>('organizationMemberships', {
    filter: { identityId },
  });
  return response.dataItems.map((item) => mapWixMembershipItem(item.data)).filter((m): m is Membership => m !== null);
}

export async function listMembershipsForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<Membership[]> {
  if (dataAdapterMode === 'mock') {
    return membershipFixtures.filter((m) => m.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixMembershipItem>('organizationMemberships', {
    filter: { organizationId },
  });
  return response.dataItems.map((item) => mapWixMembershipItem(item.data)).filter((m): m is Membership => m !== null);
}

/** An "active" membership check that also treats a not-yet-activated
    ('invited') or deactivated ('disabled'/'removed') row as not granting
    access — used everywhere a caller needs to know "can this identity
    currently act in this organization." */
export function isActiveMembership(membership: Membership | null): membership is Membership {
  return membership !== null && membership.status === 'active';
}

/**
 * Idempotent by `(identityId, organizationId)` — an identity has at most
 * one membership row per organization. Used both by direct membership
 * creation and by `services/invitationService.ts` (which creates it with
 * `status: 'invited'`).
 */
export async function createMembership(
  params: { identityId: string; organizationId: string; role: string; status: 'invited' | 'active'; invitedBy: string | null; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ membership: Membership; isNew: boolean }> {
  const existing = await getMembership(params.identityId, params.organizationId, dataAdapterMode);
  if (existing) return { membership: existing, isNew: false };

  const now = nowIso();
  const membership: Membership = {
    id: params.idFactory(),
    identityId: params.identityId,
    organizationId: params.organizationId,
    role: params.role,
    status: params.status,
    invitedBy: params.invitedBy,
    joinedAt: params.status === 'active' ? now : null,
    createdAt: now,
    updatedAt: now,
  };

  if (dataAdapterMode === 'mock') {
    membershipFixtures.push(membership);
    return { membership, isNew: true };
  }

  const inserted = await insertWixDataItem<WixMembershipItem>('organizationMemberships', buildWixMembershipData(membership), membership.id);
  const mapped = mapWixMembershipItem(inserted.data);
  if (!mapped) throw new Error('Failed to create membership.');
  return { membership: mapped, isNew: true };
}

export async function updateMembership(
  membershipId: string,
  patch: Partial<Membership>,
  dataAdapterMode: DataAdapterMode,
): Promise<Membership | null> {
  const nextPatch = { ...patch, updatedAt: nowIso() };

  if (dataAdapterMode === 'mock') {
    const index = membershipFixtures.findIndex((m) => m.id === membershipId);
    if (index === -1) return null;
    membershipFixtures[index] = { ...membershipFixtures[index], ...nextPatch };
    return membershipFixtures[index];
  }

  const response = await queryWixDataItems<WixMembershipItem>('organizationMemberships', {
    filter: { beaconMembershipId: membershipId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyMembershipUpdateToWixData(existingItem.data, nextPatch);
  const updated = await updateWixDataItem<WixMembershipItem>('organizationMemberships', existingItem.id, merged);
  return mapWixMembershipItem(updated.data);
}

/** Transitions an 'invited' membership to 'active', setting `joinedAt` —
    idempotent: an already-'active' membership is returned unchanged. */
export async function activateMembership(membershipId: string, dataAdapterMode: DataAdapterMode): Promise<Membership | null> {
  const response =
    dataAdapterMode === 'mock'
      ? membershipFixtures.find((m) => m.id === membershipId) ?? null
      : await (async () => {
          const found = await queryWixDataItems<WixMembershipItem>('organizationMemberships', {
            filter: { beaconMembershipId: membershipId },
            paging: { limit: 1 },
          });
          return mapWixMembershipItem(found.dataItems[0]?.data);
        })();
  if (!response) return null;
  if (response.status === 'active') return response;

  return updateMembership(membershipId, { status: 'active', joinedAt: nowIso() }, dataAdapterMode);
}
