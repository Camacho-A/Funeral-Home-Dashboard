import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixNotificationItem, buildWixNotificationData, applyNotificationPatchToWixData, type WixNotificationItem } from '../lib/wixNotificationMapper';
import {
  mapWixNotificationRecipientItem,
  buildWixNotificationRecipientData,
  applyNotificationRecipientUpdateToWixData,
  type WixNotificationRecipientItem,
} from '../lib/wixNotificationRecipientMapper';
import { mapWixNotificationDeliveryItem, buildWixNotificationDeliveryData, applyNotificationDeliveryUpdateToWixData, type WixNotificationDeliveryItem } from '../lib/wixNotificationDeliveryMapper';
import { buildWixNotificationDeliveryAttemptData, type WixNotificationDeliveryAttemptItem } from '../lib/wixNotificationDeliveryAttemptMapper';
import {
  mapWixNotificationPreferenceItem,
  buildWixNotificationPreferenceData,
  applyNotificationPreferenceUpdateToWixData,
  type WixNotificationPreferenceItem,
} from '../lib/wixNotificationPreferenceMapper';
import type { Notification, NewNotificationInput } from '../types/notification';
import type { NotificationRecipient } from '../types/notificationRecipient';
import type { NotificationDelivery, NotificationChannel } from '../types/notificationDelivery';
import type { NotificationDeliveryAttempt } from '../types/notificationDeliveryAttempt';
import type { NotificationPreference, NotificationPreferencePatch } from '../types/notificationPreference';
import { DEFAULT_NOTIFICATION_PREFERENCE } from '../types/notificationPreference';
import type { NotificationCategory } from '../domain/notifications/notificationTypeRegistry';
import { isValidNotificationTypeKey, getNotificationTypeDefinition } from '../domain/notifications/notificationTypeRegistry';
import { resolveNotificationContent } from '../domain/notifications/notificationTemplateRegistry';
import { resolveRecipientIdentityIds, RecipientResolverError } from './notifications/recipientResolver';
import { sendEmailNotification } from './notifications/emailChannel';
import { deliverInApp } from './notifications/inAppChannel';
import { getIdentityById } from './identityService';
import { getPortalUserById } from './portal/portalUserService';
import {
  recordNotificationCreated,
  recordNotificationSent,
  recordNotificationDelivered,
  recordNotificationRead,
  recordNotificationFailed,
  recordNotificationCancelled,
  type ActivityContext,
} from './activityService';
import {
  notificationFixtures,
  notificationRecipientFixtures,
  notificationDeliveryFixtures,
  notificationDeliveryAttemptFixtures,
  notificationPreferenceFixtures,
} from './__mocks__/notificationFixtures';

/**
 * Phase 28 (Communications & Notifications). **The single orchestration
 * layer** for everything that touches a `Notification`'s or a
 * `NotificationDelivery`'s lifecycle: recipient resolution, channel
 * dispatch, every `ActivityEvent`, and every read/mark-read/archive/cancel
 * transition. No route, no `SchedulingService`, no `SignatureService`, no
 * `TaskService`, and no future module ever resolves a recipient, calls a
 * channel, or writes to any of the five notification collections directly
 * — only this file does (structurally enforced, see
 * `services/notificationService.test.ts`).
 *
 * `Notification` ("what happened") and `NotificationDelivery` ("how it
 * was sent") have fully independent lifecycles — see `types/notification.ts`
 * and `types/notificationDelivery.ts`'s own header comments. This file is
 * the only place that ever advances either.
 */
export class NotificationServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

/** A Notification's own `entityType`/`entityId` are polymorphic (never a
    dedicated caseId field — see types/notification.ts). Activity events
    still need a caseId for case-scoped audit-trail visibility, so this
    derives one: the notification's own entity when it *is* a case, else
    the caseId explicitly supplied for a case_participants-scoped
    notification, else null (e.g. an organization-wide or system
    notification with no case at all). */
function resolveCaseIdForActivity(entityType: string | null | undefined, entityId: string | null | undefined, explicitCaseId: string | null | undefined): string | null {
  if (entityType === 'case' && entityId) return entityId;
  return explicitCaseId ?? null;
}

// ---------------------------------------------------------------------------
// Persistence — Notification
// ---------------------------------------------------------------------------

async function persistNotification(notification: Notification, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    notificationFixtures.push(notification);
    return;
  }
  await insertWixDataItem<WixNotificationItem>('notifications', buildWixNotificationData(notification), notification.id);
}

async function patchNotification(organizationId: string, notificationId: string, patch: Partial<Omit<Notification, 'id' | 'organizationId'>>, dataAdapterMode: DataAdapterMode): Promise<Notification> {
  if (dataAdapterMode === 'mock') {
    const index = notificationFixtures.findIndex((n) => n.id === notificationId && n.organizationId === organizationId);
    if (index === -1) throw new NotificationServiceError('Notification not found.');
    notificationFixtures[index] = { ...notificationFixtures[index], ...patch };
    return notificationFixtures[index];
  }
  const response = await queryWixDataItems<WixNotificationItem>('notifications', { filter: { organizationId, beaconNotificationId: notificationId }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new NotificationServiceError('Notification not found.');
  const merged = applyNotificationPatchToWixData(existingItem.data, patch as Partial<WixNotificationItem>);
  const updated = await updateWixDataItem<WixNotificationItem>('notifications', existingItem.id, merged);
  const mapped = mapWixNotificationItem(updated.data);
  if (!mapped) throw new NotificationServiceError('Failed to update notification.');
  return mapped;
}

export async function getNotification(organizationId: string, notificationId: string, dataAdapterMode: DataAdapterMode): Promise<Notification | null> {
  if (dataAdapterMode === 'mock') {
    return notificationFixtures.find((n) => n.id === notificationId && n.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixNotificationItem>('notifications', { filter: { organizationId, beaconNotificationId: notificationId }, paging: { limit: 1 } });
  return mapWixNotificationItem(response.dataItems[0]?.data);
}

// ---------------------------------------------------------------------------
// Persistence — NotificationRecipient
// ---------------------------------------------------------------------------

async function persistRecipient(recipient: NotificationRecipient, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    notificationRecipientFixtures.push(recipient);
    return;
  }
  await insertWixDataItem<WixNotificationRecipientItem>('notificationRecipients', buildWixNotificationRecipientData(recipient), recipient.id);
}

async function patchRecipient(
  organizationId: string,
  recipientId: string,
  patch: Partial<Pick<NotificationRecipient, 'readAt' | 'archivedAt'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<NotificationRecipient> {
  if (dataAdapterMode === 'mock') {
    const index = notificationRecipientFixtures.findIndex((r) => r.id === recipientId && r.organizationId === organizationId);
    if (index === -1) throw new NotificationServiceError('Notification recipient not found.');
    notificationRecipientFixtures[index] = { ...notificationRecipientFixtures[index], ...patch };
    return notificationRecipientFixtures[index];
  }
  const response = await queryWixDataItems<WixNotificationRecipientItem>('notificationRecipients', {
    filter: { organizationId, beaconNotificationRecipientId: recipientId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new NotificationServiceError('Notification recipient not found.');
  const merged = applyNotificationRecipientUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixNotificationRecipientItem>('notificationRecipients', existingItem.id, merged);
  const mapped = mapWixNotificationRecipientItem(updated.data);
  if (!mapped) throw new NotificationServiceError('Failed to update notification recipient.');
  return mapped;
}

async function getRecipient(organizationId: string, recipientId: string, dataAdapterMode: DataAdapterMode): Promise<NotificationRecipient | null> {
  if (dataAdapterMode === 'mock') {
    return notificationRecipientFixtures.find((r) => r.id === recipientId && r.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixNotificationRecipientItem>('notificationRecipients', {
    filter: { organizationId, beaconNotificationRecipientId: recipientId },
    paging: { limit: 1 },
  });
  return mapWixNotificationRecipientItem(response.dataItems[0]?.data);
}

// ---------------------------------------------------------------------------
// Persistence — NotificationDelivery
// ---------------------------------------------------------------------------

async function persistDelivery(delivery: NotificationDelivery, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    notificationDeliveryFixtures.push(delivery);
    return;
  }
  await insertWixDataItem<WixNotificationDeliveryItem>('notificationDeliveries', buildWixNotificationDeliveryData(delivery), delivery.id);
}

async function patchDelivery(
  organizationId: string,
  deliveryId: string,
  patch: Partial<Pick<NotificationDelivery, 'status' | 'attemptCount' | 'lastAttemptAt'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<NotificationDelivery> {
  if (dataAdapterMode === 'mock') {
    const index = notificationDeliveryFixtures.findIndex((d) => d.id === deliveryId && d.organizationId === organizationId);
    if (index === -1) throw new NotificationServiceError('Notification delivery not found.');
    notificationDeliveryFixtures[index] = { ...notificationDeliveryFixtures[index], ...patch };
    return notificationDeliveryFixtures[index];
  }
  const response = await queryWixDataItems<WixNotificationDeliveryItem>('notificationDeliveries', {
    filter: { organizationId, beaconNotificationDeliveryId: deliveryId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new NotificationServiceError('Notification delivery not found.');
  const merged = applyNotificationDeliveryUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixNotificationDeliveryItem>('notificationDeliveries', existingItem.id, merged);
  const mapped = mapWixNotificationDeliveryItem(updated.data);
  if (!mapped) throw new NotificationServiceError('Failed to update notification delivery.');
  return mapped;
}

async function findDeliveryByRecipientAndChannel(
  organizationId: string,
  notificationRecipientId: string,
  channel: NotificationChannel,
  dataAdapterMode: DataAdapterMode,
): Promise<NotificationDelivery | null> {
  const deliveryId = `${notificationRecipientId}-${channel}`;
  if (dataAdapterMode === 'mock') {
    return notificationDeliveryFixtures.find((d) => d.id === deliveryId && d.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixNotificationDeliveryItem>('notificationDeliveries', {
    filter: { organizationId, beaconNotificationDeliveryId: deliveryId },
    paging: { limit: 1 },
  });
  return mapWixNotificationDeliveryItem(response.dataItems[0]?.data);
}

// ---------------------------------------------------------------------------
// Persistence — NotificationDeliveryAttempt (insert-only)
// ---------------------------------------------------------------------------

async function persistDeliveryAttempt(attempt: NotificationDeliveryAttempt, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    notificationDeliveryAttemptFixtures.push(attempt);
    return;
  }
  await insertWixDataItem<WixNotificationDeliveryAttemptItem>('notificationDeliveryAttempts', buildWixNotificationDeliveryAttemptData(attempt), attempt.id);
}

// ---------------------------------------------------------------------------
// Persistence — NotificationPreference
// ---------------------------------------------------------------------------

async function getPreferenceRow(organizationId: string, identityId: string, dataAdapterMode: DataAdapterMode): Promise<NotificationPreference | null> {
  const preferenceId = `${organizationId}-${identityId}`;
  if (dataAdapterMode === 'mock') {
    return notificationPreferenceFixtures.find((p) => p.id === preferenceId) ?? null;
  }
  const response = await queryWixDataItems<WixNotificationPreferenceItem>('notificationPreferences', {
    filter: { organizationId, beaconNotificationPreferenceId: preferenceId },
    paging: { limit: 1 },
  });
  return mapWixNotificationPreferenceItem(response.dataItems[0]?.data);
}

async function insertPreference(preference: NotificationPreference, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    notificationPreferenceFixtures.push(preference);
    return;
  }
  await insertWixDataItem<WixNotificationPreferenceItem>('notificationPreferences', buildWixNotificationPreferenceData(preference), preference.id);
}

async function patchPreference(
  organizationId: string,
  identityId: string,
  patch: Partial<Pick<NotificationPreference, 'emailEnabled' | 'inAppEnabled' | 'updatedAt'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<NotificationPreference> {
  const preferenceId = `${organizationId}-${identityId}`;
  if (dataAdapterMode === 'mock') {
    const index = notificationPreferenceFixtures.findIndex((p) => p.id === preferenceId);
    if (index === -1) throw new NotificationServiceError('Notification preference not found.');
    notificationPreferenceFixtures[index] = { ...notificationPreferenceFixtures[index], ...patch };
    return notificationPreferenceFixtures[index];
  }
  const response = await queryWixDataItems<WixNotificationPreferenceItem>('notificationPreferences', {
    filter: { organizationId, beaconNotificationPreferenceId: preferenceId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new NotificationServiceError('Notification preference not found.');
  const merged = applyNotificationPreferenceUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixNotificationPreferenceItem>('notificationPreferences', existingItem.id, merged);
  const mapped = mapWixNotificationPreferenceItem(updated.data);
  if (!mapped) throw new NotificationServiceError('Failed to update notification preference.');
  return mapped;
}

/** A missing row resolves to `DEFAULT_NOTIFICATION_PREFERENCE` (both
    channels enabled) — this is a synthetic, unpersisted view, never an
    eagerly-seeded row (see types/notificationPreference.ts's own header
    comment for why). */
export async function getPreferences(organizationId: string, identityId: string, dataAdapterMode: DataAdapterMode): Promise<NotificationPreference> {
  const row = await getPreferenceRow(organizationId, identityId, dataAdapterMode);
  if (row) return row;
  return { id: `${organizationId}-${identityId}`, organizationId, identityId, updatedAt: nowIso(), ...DEFAULT_NOTIFICATION_PREFERENCE };
}

export async function updatePreferences(
  organizationId: string,
  identityId: string,
  patch: NotificationPreferencePatch,
  dataAdapterMode: DataAdapterMode,
): Promise<NotificationPreference> {
  const existingRow = await getPreferenceRow(organizationId, identityId, dataAdapterMode);
  const now = nowIso();
  if (!existingRow) {
    const created: NotificationPreference = {
      id: `${organizationId}-${identityId}`,
      organizationId,
      identityId,
      updatedAt: now,
      ...DEFAULT_NOTIFICATION_PREFERENCE,
      ...patch,
    };
    await insertPreference(created, dataAdapterMode);
    return created;
  }
  return patchPreference(organizationId, identityId, { ...patch, updatedAt: now }, dataAdapterMode);
}

// ---------------------------------------------------------------------------
// Channel dispatch — one recipient x one channel
// ---------------------------------------------------------------------------

async function dispatchChannel(
  notification: Notification,
  recipient: NotificationRecipient,
  channel: NotificationChannel,
  content: { title: string; body: string; actionUrl: string | null },
  ctx: ActivityContext,
  caseIdForActivity: string | null,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const now = nowIso();
  const delivery: NotificationDelivery = {
    id: `${recipient.id}-${channel}`,
    organizationId: notification.organizationId,
    notificationId: notification.id,
    notificationRecipientId: recipient.id,
    identityId: recipient.identityId,
    channel,
    status: 'pending',
    attemptCount: 0,
    lastAttemptAt: null,
    createdAt: now,
  };
  await persistDelivery(delivery, dataAdapterMode);

  let succeeded: boolean;
  let errorMessage: string | null = null;
  try {
    if (channel === 'in_app') {
      await deliverInApp();
    } else {
      // Phase 29 (Family Portal & External Collaboration): a
      // 'portal_user'-scope recipient's id is a PortalUser.id, never an
      // Identity.id (see recipientResolver.ts's own comment) — every
      // existing staff notification still resolves via getIdentityById
      // exactly as before, unchanged; this fallback is reached only when
      // that lookup returns null.
      const identity = await getIdentityById(recipient.identityId, dataAdapterMode);
      if (identity) {
        await sendEmailNotification(identity.email, content);
      } else {
        const portalUser = await getPortalUserById(recipient.identityId, dataAdapterMode);
        if (!portalUser) throw new Error(`No identity or portal user found for id "${recipient.identityId}".`);
        await sendEmailNotification(portalUser.email, content);
      }
    }
    succeeded = true;
  } catch (error) {
    succeeded = false;
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const attemptedAt = nowIso();
  await persistDeliveryAttempt(
    { id: `${delivery.id}-attempt-1`, organizationId: notification.organizationId, notificationDeliveryId: delivery.id, succeeded, errorMessage, attemptedAt },
    dataAdapterMode,
  );

  const nextStatus = succeeded ? (channel === 'in_app' ? 'delivered' : 'sent') : 'failed';
  await patchDelivery(notification.organizationId, delivery.id, { status: nextStatus, attemptCount: 1, lastAttemptAt: attemptedAt }, dataAdapterMode);

  try {
    if (succeeded) {
      await recordNotificationDelivered(ctx, caseIdForActivity, notification.id, recipient.identityId, channel, dataAdapterMode);
    } else {
      await recordNotificationFailed(ctx, caseIdForActivity, notification.id, recipient.identityId, channel, errorMessage ?? 'Unknown error', dataAdapterMode);
    }
  } catch (error) {
    console.error('Failed to record notification delivery activity event:', error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function createNotification(
  params: NewNotificationInput & { idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<Notification> {
  if (!isValidNotificationTypeKey(params.notificationType)) {
    throw new NotificationServiceError(`Unrecognized notification type: "${params.notificationType}".`);
  }
  const definition = getNotificationTypeDefinition(params.notificationType);
  if (!definition) throw new NotificationServiceError(`Unrecognized notification type: "${params.notificationType}".`);

  const now = params.now ?? nowIso();
  const entityType = params.entityType ?? null;
  const entityId = params.entityId ?? null;
  const caseIdForActivity = resolveCaseIdForActivity(entityType, entityId, params.caseId);
  const content = resolveNotificationContent(params.notificationType, params.tokens ?? {}, params.actionUrl ?? null);
  const notificationId = params.idFactory();
  const isDraft = params.saveAsDraft === true;

  const notification: Notification = {
    id: notificationId,
    organizationId: ctx.organizationId,
    notificationType: params.notificationType,
    category: definition.category,
    title: content.title,
    body: content.body,
    actionUrl: content.actionUrl,
    entityType,
    entityId,
    recipientScope: params.recipientScope,
    recipientRoleKey: params.recipientScope === 'role' ? (params.recipientRoleKey ?? null) : null,
    status: isDraft ? 'draft' : 'queued',
    actorIdentityId: ctx.actorIdentityId,
    correlationId: ctx.correlationId,
    createdAt: now,
    updatedAt: now,
  };
  await persistNotification(notification, dataAdapterMode);

  try {
    await recordNotificationCreated(ctx, caseIdForActivity, notificationId, params.notificationType, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record notification.created activity event:', error instanceof Error ? error.message : error);
  }

  if (isDraft) return notification;

  // RecipientResolverError is caught and rewrapped here rather than left
  // to propagate — recipientResolver.ts is only ever imported from this
  // file (structurally enforced, see this file's own test), so its error
  // type must never leak out to a caller as something they'd need to
  // import that module themselves to catch.
  let recipientIdentityIds: string[];
  try {
    recipientIdentityIds = await resolveRecipientIdentityIds(
      {
        organizationId: ctx.organizationId,
        recipientScope: params.recipientScope,
        recipientIdentityId: params.recipientIdentityId,
        recipientPortalUserId: params.recipientPortalUserId,
        recipientRoleKey: params.recipientRoleKey,
        caseId: params.caseId,
      },
      dataAdapterMode,
    );
  } catch (error) {
    if (error instanceof RecipientResolverError) throw new NotificationServiceError(error.message);
    throw error;
  }

  for (const identityId of recipientIdentityIds) {
    const recipient: NotificationRecipient = {
      id: `${notificationId}-${identityId}`,
      organizationId: ctx.organizationId,
      notificationId,
      identityId,
      readAt: null,
      archivedAt: null,
      createdAt: now,
    };
    await persistRecipient(recipient, dataAdapterMode);

    const preference = await getPreferences(ctx.organizationId, identityId, dataAdapterMode);
    const channels: NotificationChannel[] = [];
    if (preference.inAppEnabled) channels.push('in_app');
    if (preference.emailEnabled) channels.push('email');

    for (const channel of channels) {
      await dispatchChannel(notification, recipient, channel, content, ctx, caseIdForActivity, dataAdapterMode);
    }
  }

  const activated = await patchNotification(ctx.organizationId, notificationId, { status: 'active', updatedAt: nowIso() }, dataAdapterMode);
  try {
    await recordNotificationSent(ctx, caseIdForActivity, notificationId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record notification.sent activity event:', error instanceof Error ? error.message : error);
  }
  return activated;
}

export async function cancelNotification(organizationId: string, notificationId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<Notification> {
  const existing = await getNotification(organizationId, notificationId, dataAdapterMode);
  if (!existing) throw new NotificationServiceError('Notification not found.');
  if (existing.status !== 'draft' && existing.status !== 'queued') {
    throw new NotificationServiceError('Only a draft or queued notification can be cancelled.');
  }

  const updated = await patchNotification(organizationId, notificationId, { status: 'cancelled', updatedAt: nowIso() }, dataAdapterMode);
  try {
    await recordNotificationCancelled(ctx, resolveCaseIdForActivity(existing.entityType, existing.entityId, null), notificationId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record notification.cancelled activity event:', error instanceof Error ? error.message : error);
  }
  return updated;
}

export async function markRead(organizationId: string, notificationRecipientId: string, identityId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<NotificationRecipient> {
  const recipient = await getRecipient(organizationId, notificationRecipientId, dataAdapterMode);
  if (!recipient) throw new NotificationServiceError('Notification recipient not found.');
  if (recipient.identityId !== identityId) throw new NotificationServiceError('This notification does not belong to the requesting identity.');
  if (recipient.readAt !== null) return recipient;

  const now = nowIso();
  const updated = await patchRecipient(organizationId, notificationRecipientId, { readAt: now }, dataAdapterMode);

  const inAppDelivery = await findDeliveryByRecipientAndChannel(organizationId, notificationRecipientId, 'in_app', dataAdapterMode);
  if (inAppDelivery && inAppDelivery.status !== 'read') {
    await patchDelivery(organizationId, inAppDelivery.id, { status: 'read', lastAttemptAt: now }, dataAdapterMode);
  }

  try {
    const notification = await getNotification(organizationId, recipient.notificationId, dataAdapterMode);
    await recordNotificationRead(ctx, notification ? resolveCaseIdForActivity(notification.entityType, notification.entityId, null) : null, recipient.notificationId, identityId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record notification.read activity event:', error instanceof Error ? error.message : error);
  }

  return updated;
}

export async function archiveNotificationForRecipient(
  organizationId: string,
  notificationRecipientId: string,
  identityId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<NotificationRecipient> {
  const recipient = await getRecipient(organizationId, notificationRecipientId, dataAdapterMode);
  if (!recipient) throw new NotificationServiceError('Notification recipient not found.');
  if (recipient.identityId !== identityId) throw new NotificationServiceError('This notification does not belong to the requesting identity.');
  if (recipient.archivedAt !== null) return recipient;

  return patchRecipient(organizationId, notificationRecipientId, { archivedAt: nowIso() }, dataAdapterMode);
}

// ---------------------------------------------------------------------------
// Cursor encode/decode — mirrors services/activityService.ts's own pattern
// exactly, applied independently here since these paginate a different pair
// of collections.
// ---------------------------------------------------------------------------

type NotificationCursor = { createdAt: string; id: string };

function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): NotificationCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed && typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // fall through — an invalid, client-supplied cursor starts from the beginning, never throws.
  }
  return null;
}

function isPastCursor(createdAt: string, id: string, cursor: NotificationCursor): boolean {
  if (createdAt < cursor.createdAt) return true;
  if (createdAt > cursor.createdAt) return false;
  return id < cursor.id;
}

const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;
const WIX_FETCH_WINDOW = 250;

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.trunc(limit), MAX_PAGE_LIMIT);
}

// ---------------------------------------------------------------------------
// Listing — the current identity's own inbox
// ---------------------------------------------------------------------------

export type NotificationInboxItem = { notification: Notification; recipient: NotificationRecipient };
export type NotificationInboxFilters = { category?: NotificationCategory; unreadOnly?: boolean; includeArchived?: boolean };
export type NotificationInboxResult = { items: NotificationInboxItem[]; nextCursor: string | null };

export async function listForRecipient(
  organizationId: string,
  identityId: string,
  filters: NotificationInboxFilters,
  cursorRaw: string | null,
  limit: number,
  dataAdapterMode: DataAdapterMode,
): Promise<NotificationInboxResult> {
  const limitToUse = boundedLimit(limit);
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;

  let recipientCandidates: NotificationRecipient[];
  if (dataAdapterMode === 'mock') {
    recipientCandidates = notificationRecipientFixtures.filter((r) => r.organizationId === organizationId && r.identityId === identityId);
  } else {
    const wixFilter: Record<string, unknown> = { organizationId, identityId };
    if (cursor) wixFilter.createdAt = { $lte: cursor.createdAt };
    const response = await queryWixDataItems<WixNotificationRecipientItem>('notificationRecipients', {
      filter: wixFilter,
      sort: [{ fieldName: 'createdAt', order: 'DESC' }],
      paging: { limit: WIX_FETCH_WINDOW },
    });
    recipientCandidates = response.dataItems.map((item) => mapWixNotificationRecipientItem(item.data)).filter((r): r is NotificationRecipient => r !== null);
  }

  // No batch/`$in` lookup exists in this codebase's Wix Data layer (see
  // services/scheduling/appointmentReads.ts's own precedent for the same
  // constraint) — each candidate recipient row's Notification is read
  // individually, bounded to at most WIX_FETCH_WINDOW reads for this one
  // call, never per-request across the whole app.
  const joined = await Promise.all(
    recipientCandidates.map(async (recipient) => ({ recipient, notification: await getNotification(organizationId, recipient.notificationId, dataAdapterMode) })),
  );

  let filtered = joined.filter((row): row is { recipient: NotificationRecipient; notification: Notification } => row.notification !== null);
  if (!filters.includeArchived) filtered = filtered.filter((row) => row.recipient.archivedAt === null);
  if (filters.unreadOnly) filtered = filtered.filter((row) => row.recipient.readAt === null);
  if (filters.category) filtered = filtered.filter((row) => row.notification.category === filters.category);

  filtered.sort((a, b) => {
    if (a.recipient.createdAt !== b.recipient.createdAt) return a.recipient.createdAt < b.recipient.createdAt ? 1 : -1;
    return a.recipient.id < b.recipient.id ? 1 : a.recipient.id > b.recipient.id ? -1 : 0;
  });
  if (cursor) filtered = filtered.filter((row) => isPastCursor(row.recipient.createdAt, row.recipient.id, cursor));

  const page = filtered.slice(0, limitToUse);
  const hasMore = filtered.length > limitToUse;
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({ notification: row.notification, recipient: row.recipient })),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.recipient.createdAt, id: last.recipient.id }) : null,
  };
}

// ---------------------------------------------------------------------------
// Listing — the organization-wide notification log (a query projection,
// never a second audit system — see ActivityService for the one real
// audit trail).
// ---------------------------------------------------------------------------

export type NotificationOrgListResult = { notifications: Notification[]; nextCursor: string | null };

export async function listForOrganization(
  organizationId: string,
  filters: { category?: NotificationCategory },
  cursorRaw: string | null,
  limit: number,
  dataAdapterMode: DataAdapterMode,
): Promise<NotificationOrgListResult> {
  const limitToUse = boundedLimit(limit);
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;

  let candidates: Notification[];
  if (dataAdapterMode === 'mock') {
    candidates = notificationFixtures.filter((n) => n.organizationId === organizationId);
  } else {
    const wixFilter: Record<string, unknown> = { organizationId };
    if (filters.category) wixFilter.category = filters.category;
    if (cursor) wixFilter.createdAt = { $lte: cursor.createdAt };
    const response = await queryWixDataItems<WixNotificationItem>('notifications', {
      filter: wixFilter,
      sort: [{ fieldName: 'createdAt', order: 'DESC' }],
      paging: { limit: WIX_FETCH_WINDOW },
    });
    candidates = response.dataItems.map((item) => mapWixNotificationItem(item.data)).filter((n): n is Notification => n !== null);
  }

  let filtered = candidates.filter((n) => filters.category === undefined || n.category === filters.category);
  filtered.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  if (cursor) filtered = filtered.filter((n) => isPastCursor(n.createdAt, n.id, cursor));

  const page = filtered.slice(0, limitToUse);
  const hasMore = filtered.length > limitToUse;
  const last = page[page.length - 1];
  return { notifications: page, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null };
}

// ---------------------------------------------------------------------------
// Unread badge — always a live query over NotificationDelivery, never a
// separately-maintained counter (see this file's own header comment and
// ADR-032). Whether Wix Data's COUNT capability is reachable is an
// empirical question for live verification (task #243); until confirmed,
// this fetches the matching rows and counts them in application code,
// bounded by WIX_FETCH_WINDOW.
// ---------------------------------------------------------------------------

export async function getUnreadCount(organizationId: string, identityId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  if (dataAdapterMode === 'mock') {
    return notificationDeliveryFixtures.filter((d) => d.organizationId === organizationId && d.identityId === identityId && d.channel === 'in_app' && d.status !== 'read').length;
  }
  const response = await queryWixDataItems<WixNotificationDeliveryItem>('notificationDeliveries', {
    filter: { organizationId, identityId, channel: 'in_app' },
    paging: { limit: WIX_FETCH_WINDOW },
  });
  return response.dataItems
    .map((item) => mapWixNotificationDeliveryItem(item.data))
    .filter((d): d is NotificationDelivery => d !== null && d.status !== 'read').length;
}
