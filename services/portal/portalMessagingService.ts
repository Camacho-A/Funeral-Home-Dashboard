import crypto from 'crypto';
import type { DataAdapterMode } from '../../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../../lib/wixDataApi';
import {
  mapWixPortalMessageItem,
  buildWixPortalMessageData,
  applyPortalMessageReadReceiptToWixData,
  type WixPortalMessageItem,
} from '../../lib/wixPortalMessageMapper';
import { mapWixCaseItem, type WixCaseItem } from '../../lib/wixCaseMapper';
import type { PortalMessage } from '../../types/portalMessage';
import type { PortalRelationshipType } from '../../domain/portal/portalRelationshipRegistry';
import type { Case } from '../../types/case';
import { caseFixtures } from '../__mocks__/fixtures';
import { portalMessageFixtures } from '../__mocks__/portalFixtures';
import { listPortalAccessForCase } from './portalAccessService';
import { hasPortalCapability } from '../../domain/portal/portalCapabilityPolicy';
import { portalActivityContext } from './portalActivityContext';
import { recordPortalMessageSent, type ActivityContext } from '../activityService';
import { createNotification } from '../notificationService';

/**
 * Phase 29 (Family Portal & External Collaboration). The only writer of
 * the `portalMessages` collection. **Immutable and insert-only** — no
 * update or delete function exists here for the message body itself; a
 * correction is always a new message. The only two mutations this file
 * ever performs after insert are the read-receipt setters
 * (`markReadByStaff`/`markReadByFamily`).
 *
 * Every send additionally calls `notificationService.createNotification`
 * — never writes to a notification collection directly, never resolves
 * a recipient itself. Family→staff uses the ordinary `recipientScope:
 * 'role'` (`funeralDirector`) — never `case_participants` (refinement
 * #12's own "do not reopen the StaffProfile gap"). Staff→family uses
 * every currently-`active` `PortalAccess` grant with `message.read`
 * capability for this case — one notification per portal user, since a
 * case can have more than one family member with portal access.
 */
export class PortalMessagingServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

/** Mirrors `signatureService.ts`'s own private `getCaseForNotification` —
    cases are read via a client-fetch service everywhere else, but a
    server-side orchestration step mid-request needs its own small
    mock/wix-branching reader, never a `fetch()` call to this app's own
    API from inside a Route Handler. */
async function getCaseForNotification(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted) ?? null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', { filter: { beaconCaseId: caseId, organizationId, isArchived: false }, paging: { limit: 1 } });
  return mapWixCaseItem(response.dataItems[0]?.data);
}

async function persistMessage(message: PortalMessage, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    portalMessageFixtures.push(message);
    return;
  }
  await insertWixDataItem<WixPortalMessageItem>('portalMessages', buildWixPortalMessageData(message), message.id);
}

export async function listMessagesForCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<PortalMessage[]> {
  if (dataAdapterMode === 'mock') {
    return portalMessageFixtures
      .filter((m) => m.organizationId === organizationId && m.caseId === caseId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  const response = await queryWixDataItems<WixPortalMessageItem>('portalMessages', { filter: { organizationId, caseId } });
  return response.dataItems
    .map((item) => mapWixPortalMessageItem(item.data))
    .filter((m): m is PortalMessage => m !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** Staff → family. A real, staff-initiated action — attributed via the
    caller's own real `ActivityContext` (never `portalActivityContext()`,
    which is reserved for the *family* side of this thread), mirroring
    every other staff-initiated portal action in this codebase (compare
    `portalInvitationService.ts`'s `issueInvitation`). Notifies every
    currently-`active` portal grant on this case with `message.read`
    capability, via `recipientScope: 'portal_user'` — one call per
    recipient portal user, since a case can have more than one. */
export async function sendStaffMessage(
  params: { organizationId: string; caseId: string; body: string; idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalMessage> {
  if (!ctx.actorIdentityId) {
    throw new PortalMessagingServiceError('A staff-sent message requires a real actorIdentityId.');
  }

  const now = params.now ?? nowIso();
  const message: PortalMessage = {
    id: params.idFactory(),
    organizationId: params.organizationId,
    caseId: params.caseId,
    senderType: 'staff',
    senderStaffIdentityId: ctx.actorIdentityId,
    senderPortalUserId: null,
    senderPortalAccessId: null,
    senderRelationshipTypeAtSend: null,
    body: params.body,
    attachmentDocumentId: null,
    readByStaffAt: now,
    readByFamilyAt: null,
    createdAt: now,
  };
  await persistMessage(message, dataAdapterMode);

  const targetCase = await getCaseForNotification(params.organizationId, params.caseId, dataAdapterMode);
  const access = await listPortalAccessForCase(params.organizationId, params.caseId, dataAdapterMode);
  const recipients = access.filter((a) => a.status === 'active' && a.portalUserId !== null && hasPortalCapability(a, 'message.read'));

  for (const recipient of recipients) {
    try {
      await createNotification(
        {
          notificationType: 'family.message_received',
          entityType: 'portalMessage',
          entityId: message.id,
          recipientScope: 'portal_user',
          recipientPortalUserId: recipient.portalUserId!,
          caseId: params.caseId,
          tokens: { caseNumber: targetCase?.caseNumber ?? '' },
          idFactory: () => crypto.randomUUID(),
        },
        ctx,
        dataAdapterMode,
      );
    } catch (error) {
      console.error('Failed to send family.message_received notification:', error instanceof Error ? error.message : error);
    }
  }

  return message;
}

/** Family → staff. Notifies via the ordinary `recipientScope: 'role'`
    (`funeralDirector`) — never `case_participants`, matching Phase 28's
    own deferral and refinement #12's explicit instruction not to reopen
    it. Records `portal.message.sent` via the anonymous-actor
    `portalActivityContext()`, with real attribution
    (`portalUserId`/`relationshipType`) carried in `metadata`. */
export async function sendFamilyMessage(
  params: {
    organizationId: string;
    caseId: string;
    portalUserId: string;
    portalAccessId: string;
    relationshipType: PortalRelationshipType;
    body: string;
    idFactory: () => string;
    now?: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<PortalMessage> {
  const now = params.now ?? nowIso();
  const message: PortalMessage = {
    id: params.idFactory(),
    organizationId: params.organizationId,
    caseId: params.caseId,
    senderType: 'family',
    senderStaffIdentityId: null,
    senderPortalUserId: params.portalUserId,
    senderPortalAccessId: params.portalAccessId,
    senderRelationshipTypeAtSend: params.relationshipType,
    body: params.body,
    attachmentDocumentId: null,
    readByStaffAt: null,
    readByFamilyAt: now,
    createdAt: now,
  };
  await persistMessage(message, dataAdapterMode);

  const ctx: ActivityContext = portalActivityContext(params.organizationId, message.id);
  try {
    await recordPortalMessageSent(ctx, params.caseId, message.id, params.portalUserId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record portal.message.sent activity event:', error instanceof Error ? error.message : error);
  }

  const targetCase = await getCaseForNotification(params.organizationId, params.caseId, dataAdapterMode);
  try {
    await createNotification(
      {
        notificationType: 'portal.staff_message_received',
        entityType: 'portalMessage',
        entityId: message.id,
        recipientScope: 'role',
        recipientRoleKey: 'funeralDirector',
        caseId: params.caseId,
        tokens: { actorDisplayName: 'A family member', caseNumber: targetCase?.caseNumber ?? '' },
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to send portal.staff_message_received notification:', error instanceof Error ? error.message : error);
  }

  return message;
}

async function patchMessage(organizationId: string, messageId: string, patch: { readByStaffAt?: string; readByFamilyAt?: string }, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = portalMessageFixtures.findIndex((m) => m.id === messageId && m.organizationId === organizationId);
    if (index === -1) throw new PortalMessagingServiceError('Message not found.');
    portalMessageFixtures[index] = { ...portalMessageFixtures[index], ...patch };
    return;
  }
  const response = await queryWixDataItems<WixPortalMessageItem>('portalMessages', { filter: { organizationId, beaconPortalMessageId: messageId }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new PortalMessagingServiceError('Message not found.');
  const merged = applyPortalMessageReadReceiptToWixData(existingItem.data, patch);
  await updateWixDataItem<WixPortalMessageItem>('portalMessages', existingItem.id, merged);
}

export async function markReadByStaff(organizationId: string, messageId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  await patchMessage(organizationId, messageId, { readByStaffAt: nowIso() }, dataAdapterMode);
}

export async function markReadByFamily(organizationId: string, messageId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  await patchMessage(organizationId, messageId, { readByFamilyAt: nowIso() }, dataAdapterMode);
}
