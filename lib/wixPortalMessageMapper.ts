import type { PortalMessage, PortalMessageSenderType } from '../types/portalMessage';
import { isValidPortalRelationshipType } from '../domain/portal/portalRelationshipRegistry';

/**
 * Phase 29 (Family Portal & External Collaboration). The one place a raw
 * `portalMessages` Wix item is ever touched. Deliberately exports no
 * "apply full patch" function beyond the two narrow read-receipt setters
 * below — `PortalMessage` is immutable and insert-only past those two
 * fields (see `types/portalMessage.ts`'s own header comment).
 */
export type WixPortalMessageItem = {
  beaconPortalMessageId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  senderType?: unknown;
  senderStaffIdentityId?: unknown;
  senderPortalUserId?: unknown;
  senderPortalAccessId?: unknown;
  senderRelationshipTypeAtSend?: unknown;
  body?: unknown;
  attachmentDocumentId?: unknown;
  readByStaffAt?: unknown;
  readByFamilyAt?: unknown;
  createdAt?: unknown;
};

function isSenderType(value: unknown): value is PortalMessageSenderType {
  return value === 'staff' || value === 'family';
}

export function mapWixPortalMessageItem(item: WixPortalMessageItem | undefined): PortalMessage | null {
  if (
    !item ||
    typeof item.beaconPortalMessageId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    !isSenderType(item.senderType) ||
    typeof item.body !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }
  if (item.senderRelationshipTypeAtSend !== null && item.senderRelationshipTypeAtSend !== undefined && !isValidPortalRelationshipType(item.senderRelationshipTypeAtSend)) {
    return null;
  }

  return {
    id: item.beaconPortalMessageId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    senderType: item.senderType,
    senderStaffIdentityId: typeof item.senderStaffIdentityId === 'string' ? item.senderStaffIdentityId : null,
    senderPortalUserId: typeof item.senderPortalUserId === 'string' ? item.senderPortalUserId : null,
    senderPortalAccessId: typeof item.senderPortalAccessId === 'string' ? item.senderPortalAccessId : null,
    senderRelationshipTypeAtSend: isValidPortalRelationshipType(item.senderRelationshipTypeAtSend) ? item.senderRelationshipTypeAtSend : null,
    body: item.body,
    attachmentDocumentId: typeof item.attachmentDocumentId === 'string' ? item.attachmentDocumentId : null,
    readByStaffAt: typeof item.readByStaffAt === 'string' ? item.readByStaffAt : null,
    readByFamilyAt: typeof item.readByFamilyAt === 'string' ? item.readByFamilyAt : null,
    createdAt: item.createdAt,
  };
}

export function buildWixPortalMessageData(message: PortalMessage): WixPortalMessageItem {
  return {
    beaconPortalMessageId: message.id,
    organizationId: message.organizationId,
    caseId: message.caseId,
    senderType: message.senderType,
    senderStaffIdentityId: message.senderStaffIdentityId,
    senderPortalUserId: message.senderPortalUserId,
    senderPortalAccessId: message.senderPortalAccessId,
    senderRelationshipTypeAtSend: message.senderRelationshipTypeAtSend,
    body: message.body,
    attachmentDocumentId: message.attachmentDocumentId,
    readByStaffAt: message.readByStaffAt,
    readByFamilyAt: message.readByFamilyAt,
    createdAt: message.createdAt,
  };
}

/** The only two fields ever changed after insert — marking the thread
    read from either side. Never a generic patch function, matching this
    type's own immutable, insert-only invariant. */
export function applyPortalMessageReadReceiptToWixData(
  existing: WixPortalMessageItem,
  patch: { readByStaffAt?: string; readByFamilyAt?: string },
): WixPortalMessageItem {
  const next: WixPortalMessageItem = { ...existing };
  if (patch.readByStaffAt !== undefined) next.readByStaffAt = patch.readByStaffAt;
  if (patch.readByFamilyAt !== undefined) next.readByFamilyAt = patch.readByFamilyAt;
  return next;
}
