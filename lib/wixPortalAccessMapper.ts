import type { PortalAccess, PortalAccessStatus } from '../types/portalAccess';
import { isValidPortalRelationshipType } from '../domain/portal/portalRelationshipRegistry';

/**
 * Phase 29 (Family Portal & External Collaboration). The one place a raw
 * `portalAccess` Wix item is ever touched. `portalUserId` is nullable on
 * the wire exactly as it is on the type — a grant created at invite time
 * has no `PortalUser` yet (see `types/portalAccess.ts`'s own comment).
 */
export type WixPortalAccessItem = {
  beaconPortalAccessId?: unknown;
  portalUserId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  relationshipType?: unknown;
  status?: unknown;
  grantedFromInvitationId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_STATUSES: readonly PortalAccessStatus[] = ['pending', 'active', 'disabled', 'revoked', 'expired'];

function isValidStatus(value: unknown): value is PortalAccessStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

export function mapWixPortalAccessItem(item: WixPortalAccessItem | undefined): PortalAccess | null {
  if (
    !item ||
    typeof item.beaconPortalAccessId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    !isValidPortalRelationshipType(item.relationshipType) ||
    !isValidStatus(item.status) ||
    typeof item.grantedFromInvitationId !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconPortalAccessId,
    portalUserId: typeof item.portalUserId === 'string' ? item.portalUserId : null,
    organizationId: item.organizationId,
    caseId: item.caseId,
    relationshipType: item.relationshipType,
    status: item.status,
    grantedFromInvitationId: item.grantedFromInvitationId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixPortalAccessData(access: PortalAccess): WixPortalAccessItem {
  return {
    beaconPortalAccessId: access.id,
    portalUserId: access.portalUserId,
    organizationId: access.organizationId,
    caseId: access.caseId,
    relationshipType: access.relationshipType,
    status: access.status,
    grantedFromInvitationId: access.grantedFromInvitationId,
    createdAt: access.createdAt,
    updatedAt: access.updatedAt,
  };
}

/** Merges a partial patch onto the existing full Wix item. The only
    fields ever updated after creation are `portalUserId` (set once, on
    activation) and `status`/`updatedAt` — `organizationId`, `caseId`,
    `relationshipType`, and `grantedFromInvitationId` are fixed for the
    life of the row (refinement #5: nothing about the grant's scope is
    ever decided after invite time). */
export function applyPortalAccessUpdateToWixData(existing: WixPortalAccessItem, patch: Partial<PortalAccess>): WixPortalAccessItem {
  const next: WixPortalAccessItem = { ...existing };
  if (patch.portalUserId !== undefined) next.portalUserId = patch.portalUserId;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
