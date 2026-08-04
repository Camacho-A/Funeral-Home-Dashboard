import type { Notification } from '@/types/notification';
import type { NotificationRecipient } from '@/types/notificationRecipient';
import type { NotificationPreference, NotificationPreferencePatch } from '@/types/notificationPreference';
import type { NotificationCategory } from '@/domain/notifications/notificationTypeRegistry';

/**
 * Phase 28 (Communications & Notifications). Client-side fetch wrappers
 * around `/api/notifications/*` — the notification bell/drawer's and
 * preferences panel's only path to the server, matching every other
 * `lib/*Client.ts` module's reasoning (`services/notificationService.ts`
 * imports `lib/wixDataApi.ts`, server-only, and can never be imported into
 * a Client Component).
 */

export type NotificationInboxItem = { notification: Notification; recipient: NotificationRecipient };
export type NotificationInboxPage = { items: NotificationInboxItem[]; nextCursor: string | null };
export type NotificationInboxFilters = { category?: NotificationCategory; unreadOnly?: boolean };

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchNotificationInbox(organizationId: string, filters: NotificationInboxFilters, cursor: string | null): Promise<NotificationInboxPage> {
  const params = new URLSearchParams({ organizationId });
  if (filters.category) params.set('category', filters.category);
  if (filters.unreadOnly) params.set('unreadOnly', 'true');
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/notifications?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return { items: (body.items as NotificationInboxItem[]) ?? [], nextCursor: (body.nextCursor as string | null) ?? null };
}

export async function fetchUnreadNotificationCount(organizationId: string): Promise<number> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/notifications/unread-count?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.count as number) ?? 0;
}

export async function markNotificationRead(organizationId: string, notificationRecipientId: string): Promise<NotificationRecipient> {
  const response = await fetch(`/api/notifications/recipients/${encodeURIComponent(notificationRecipientId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, action: 'read' }),
  });
  const body = await parseJsonOrThrow(response);
  return body.recipient as NotificationRecipient;
}

export async function archiveNotification(organizationId: string, notificationRecipientId: string): Promise<NotificationRecipient> {
  const response = await fetch(`/api/notifications/recipients/${encodeURIComponent(notificationRecipientId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, action: 'archive' }),
  });
  const body = await parseJsonOrThrow(response);
  return body.recipient as NotificationRecipient;
}

export async function fetchNotificationPreferences(organizationId: string): Promise<NotificationPreference> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/notifications/preferences?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return body.preferences as NotificationPreference;
}

export async function updateNotificationPreferences(organizationId: string, patch: NotificationPreferencePatch): Promise<NotificationPreference> {
  const response = await fetch('/api/notifications/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, ...patch }),
  });
  const body = await parseJsonOrThrow(response);
  return body.preferences as NotificationPreference;
}
