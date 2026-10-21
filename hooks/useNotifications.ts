import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchNotificationInbox,
  fetchUnreadNotificationCount,
  markNotificationRead,
  archiveNotification,
  markAllNotificationsRead,
  fetchNotificationPreferences,
  updateNotificationPreferences,
  type NotificationInboxFilters,
} from '@/lib/notificationsClient';
import type { NotificationPreferencePatch } from '@/types/notificationPreference';

/**
 * Phase 28 (Communications & Notifications). Query/mutation hooks for the
 * notification bell/drawer and the preferences panel, bundled the same way
 * `hooks/useActivity.ts`/`hooks/useRbac.ts` bundle their own closely-related
 * sets. The inbox is keyset-paginated (see ADR-032) — `useInfiniteQuery`
 * models it directly, mirroring `useCaseActivity`'s exact shape.
 */
const inboxKey = (organizationId: string, filters: NotificationInboxFilters) => ['notificationInbox', organizationId, filters];
const unreadCountKey = (organizationId: string) => ['notificationUnreadCount', organizationId];
const preferencesKey = (organizationId: string) => ['notificationPreferences', organizationId];

/** `enabled` defaults to true but is deliberately a caller-supplied param
    (mirroring `useOrganizationActivity`'s own exact pattern) —
    `NotificationDrawer` passes its own `open` state here, so the inbox is
    never fetched in the background while the drawer is closed, even
    though it's always mounted (rendered by `NotificationBell` regardless
    of open state, so `Modal` can own its own focus-trap lifecycle). */
export function useNotificationInbox(organizationId: string, filters: NotificationInboxFilters = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: inboxKey(organizationId, filters),
    queryFn: ({ pageParam }) => fetchNotificationInbox(organizationId, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(organizationId) && enabled,
  });
}

/** Polled every 60s — the unread badge is always a live query (see
    `services/notificationService.ts`'s own header comment), never a
    client-cached running total that could drift. */
export function useUnreadNotificationCount(organizationId: string) {
  return useQuery({
    queryKey: unreadCountKey(organizationId),
    queryFn: () => fetchUnreadNotificationCount(organizationId),
    enabled: Boolean(organizationId),
    refetchInterval: 60_000,
  });
}

type InboxPage = Awaited<ReturnType<typeof fetchNotificationInbox>>;
type InboxData = { pages: InboxPage[]; pageParams: unknown[] };
type Snapshot = { count: number | undefined; inboxes: [readonly unknown[], InboxData | undefined][] };

/**
 * Read = archived, and the badge moves at once (2026-10).
 *
 * Marking a notification read archives it, so it leaves the inbox and only
 * the Archived tab shows it. Waiting for the round trip left the badge and
 * the list showing it as unread for a moment after the click; this applies
 * the change to the cached badge and lists immediately, restores them if
 * the server refuses, and re-reads both from the server either way.
 */
function applyReadAndArchived(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string,
  target: { ids: string[] } | 'all-unread',
): Snapshot {
  const snapshot: Snapshot = {
    count: queryClient.getQueryData<number>(unreadCountKey(organizationId)),
    inboxes: queryClient.getQueriesData<InboxData>({ queryKey: ['notificationInbox', organizationId] }),
  };
  const now = new Date().toISOString();
  // "Mark all as read" clears everything still in the inbox — unread rows
  // and rows read before read-meant-archived — matching the server.
  const matches = (recipient: { id: string; readAt: string | null; archivedAt: string | null }) =>
    target === 'all-unread' ? recipient.readAt === null || recipient.archivedAt === null : target.ids.includes(recipient.id);

  const clearedUnread = new Set<string>();
  for (const [key, data] of snapshot.inboxes) {
    if (!data) continue;
    const filters = (key[2] ?? {}) as NotificationInboxFilters;
    queryClient.setQueryData<InboxData>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.flatMap((item) => {
          if (!matches(item.recipient)) return [item];
          if (item.recipient.readAt === null) clearedUnread.add(item.recipient.id);
          // A list that shows archived rows keeps it, now read and archived;
          // every other list drops it.
          return filters.includeArchived
            ? [{ ...item, recipient: { ...item.recipient, readAt: item.recipient.readAt ?? now, archivedAt: item.recipient.archivedAt ?? now } }]
            : [];
        }),
      })),
    });
  }

  if (snapshot.count !== undefined) {
    const next = target === 'all-unread' ? 0 : Math.max(0, snapshot.count - clearedUnread.size);
    queryClient.setQueryData<number>(unreadCountKey(organizationId), next);
  }
  return snapshot;
}

function useReadAndArchiveMutation<TVariables>(
  organizationId: string,
  mutationFn: (variables: TVariables) => Promise<unknown>,
  targetOf: (variables: TVariables) => { ids: string[] } | 'all-unread',
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey: ['notificationInbox', organizationId] });
      await queryClient.cancelQueries({ queryKey: unreadCountKey(organizationId) });
      return applyReadAndArchived(queryClient, organizationId, targetOf(variables));
    },
    onError: (_error, _variables, snapshot) => {
      if (!snapshot) return;
      queryClient.setQueryData(unreadCountKey(organizationId), snapshot.count);
      for (const [key, data] of snapshot.inboxes) queryClient.setQueryData(key, data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationInbox', organizationId] });
      queryClient.invalidateQueries({ queryKey: unreadCountKey(organizationId) });
    },
  });
}

/** Notification Center (2026-10). Marks — and therefore archives — every
    unread notification. */
export function useMarkAllNotificationsRead(organizationId: string) {
  return useReadAndArchiveMutation<void>(organizationId, () => markAllNotificationsRead(organizationId), () => 'all-unread');
}

/** Marks one notification read, which archives it. */
export function useMarkNotificationRead(organizationId: string) {
  return useReadAndArchiveMutation<string>(
    organizationId,
    (notificationRecipientId) => markNotificationRead(organizationId, notificationRecipientId),
    (notificationRecipientId) => ({ ids: [notificationRecipientId] }),
  );
}

/** Archives one notification, which also reads it. */
export function useArchiveNotification(organizationId: string) {
  return useReadAndArchiveMutation<string>(
    organizationId,
    (notificationRecipientId) => archiveNotification(organizationId, notificationRecipientId),
    (notificationRecipientId) => ({ ids: [notificationRecipientId] }),
  );
}

export function useNotificationPreferences(organizationId: string) {
  return useQuery({
    queryKey: preferencesKey(organizationId),
    queryFn: () => fetchNotificationPreferences(organizationId),
    enabled: Boolean(organizationId),
  });
}

export function useUpdateNotificationPreferences(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: NotificationPreferencePatch) => updateNotificationPreferences(organizationId, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: preferencesKey(organizationId) }),
  });
}
