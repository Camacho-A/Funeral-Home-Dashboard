import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchNotificationInbox,
  fetchUnreadNotificationCount,
  markNotificationRead,
  archiveNotification,
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

export function useMarkNotificationRead(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationRecipientId: string) => markNotificationRead(organizationId, notificationRecipientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationInbox', organizationId] });
      queryClient.invalidateQueries({ queryKey: unreadCountKey(organizationId) });
    },
  });
}

export function useArchiveNotification(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationRecipientId: string) => archiveNotification(organizationId, notificationRecipientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationInbox', organizationId] });
      queryClient.invalidateQueries({ queryKey: unreadCountKey(organizationId) });
    },
  });
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
