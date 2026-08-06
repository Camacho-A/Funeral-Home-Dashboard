import type { PortalRelationshipType } from '../domain/portal/portalRelationshipRegistry';

/**
 * Phase 29 (Family Portal & External Collaboration). A single message in
 * a case's two-party thread (the case's staff team vs. the case's family/
 * portal users) — `(organizationId, caseId)` itself is the thread key, no
 * separate thread entity. **Immutable and insert-only**: no update or
 * delete function exists anywhere for this type — a correction is always
 * a new message (`services/portal/portalMessagingService.ts`'s own
 * comment). No live chat, typing indicators, editing, or deletion.
 *
 * Exactly one of `senderStaffIdentityId`/`senderPortalUserId` is set,
 * matching `senderType`. For a family-sent message,
 * `senderRelationshipTypeAtSend` is a denormalized snapshot — a message's
 * own meaning ("sent by the Executor") never retroactively changes if
 * staff later corrects the relationship type on the access grant.
 */
export type PortalMessageSenderType = 'staff' | 'family';

export type PortalMessage = {
  id: string;
  organizationId: string;
  caseId: string;
  senderType: PortalMessageSenderType;
  senderStaffIdentityId: string | null;
  senderPortalUserId: string | null;
  senderPortalAccessId: string | null;
  senderRelationshipTypeAtSend: PortalRelationshipType | null;
  body: string;
  /** Reserved — always null this phase, never wired. */
  attachmentDocumentId: string | null;
  readByStaffAt: string | null;
  readByFamilyAt: string | null;
  createdAt: string;
};
