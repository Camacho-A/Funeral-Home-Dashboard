import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFamilyNotifications,
  fetchFamilyUnreadNotificationCount,
  setFamilyNotificationRecipientAction,
  fetchFamilyNotificationPreferences,
  updateFamilyNotificationPreferences,
} from '@/lib/familyClient';

/**
 * Phase 29 (Family Portal & External Collaboration). Query/mutation hooks
 * for the family surface's own notification inbox/preferences — mirrors
 * `hooks/useNotifications.ts`'s exact shape (self-scoped, no
 * organizationId param needed since every `/api/family/notifications/*`
 * route resolves the caller's own primary organization server-side).
 */
const inboxKey = ['familyNotificationInbox'];
const unreadCountKey = ['familyNotificationUnreadCount'];
const preferencesKey = ['familyNotificationPreferences'];

export function useFamilyNotificationInbox() {
  return useInfiniteQuery({
    queryKey: inboxKey,
    queryFn: ({ pageParam }) => fetchFamilyNotifications({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** Polled every 60s — matches the staff bell's own live-query discipline. */
export function useFamilyUnreadNotificationCount() {
  return useQuery({ queryKey: unreadCountKey, queryFn: fetchFamilyUnreadNotificationCount, refetchInterval: 60_000 });
}

export function useMarkFamilyNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationRecipientId: string) => setFamilyNotificationRecipientAction({ notificationRecipientId, action: 'read' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKey });
      queryClient.invalidateQueries({ queryKey: unreadCountKey });
    },
  });
}

export function useArchiveFamilyNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationRecipientId: string) => setFamilyNotificationRecipientAction({ notificationRecipientId, action: 'archive' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKey });
      queryClient.invalidateQueries({ queryKey: unreadCountKey });
    },
  });
}

export function useFamilyNotificationPreferences() {
  return useQuery({ queryKey: preferencesKey, queryFn: fetchFamilyNotificationPreferences });
}

export function useUpdateFamilyNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { emailEnabled?: boolean; inAppEnabled?: boolean }) => updateFamilyNotificationPreferences(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: preferencesKey }),
  });
}
