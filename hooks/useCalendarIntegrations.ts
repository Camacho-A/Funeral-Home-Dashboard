import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCalendarConnections,
  disconnectCalendarConnection,
  beginCalendarConnect,
  fetchReminderPolicy,
  updateReminderPolicy,
  fetchCalendarFeedTokens,
  generateCalendarFeedToken,
  revokeCalendarFeedToken,
  fetchCalendarSyncLinks,
} from '@/lib/calendarIntegrationsClient';
import type { CalendarProviderName } from '@/types/calendarConnection';
import type { SchedulingReminderPolicyPatch } from '@/types/schedulingReminderPolicy';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Query/mutation hooks for the Settings > Calendar
 * Integrations page and the Calendar page's sync-status indicator —
 * bundled the same way `hooks/useNotifications.ts` bundles its own
 * closely-related set.
 */
const connectionsKey = (organizationId: string, scope?: 'organization') => ['calendarConnections', organizationId, scope ?? 'own'];
const reminderPolicyKey = (organizationId: string) => ['schedulingReminderPolicy', organizationId];
const feedTokensKey = (organizationId: string) => ['calendarFeedTokens', organizationId];
const syncLinksKey = (organizationId: string) => ['calendarSyncLinks', organizationId];

export function useCalendarConnections(organizationId: string, scope?: 'organization') {
  return useQuery({
    queryKey: connectionsKey(organizationId, scope),
    queryFn: () => fetchCalendarConnections(organizationId, scope),
    enabled: Boolean(organizationId),
  });
}

export function useDisconnectCalendarConnection(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => disconnectCalendarConnection(organizationId, connectionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendarConnections', organizationId] }),
  });
}

export function useBeginCalendarConnect(organizationId: string) {
  return useMutation({
    mutationFn: (provider: CalendarProviderName) => beginCalendarConnect(organizationId, provider),
  });
}

export function useReminderPolicy(organizationId: string) {
  return useQuery({
    queryKey: reminderPolicyKey(organizationId),
    queryFn: () => fetchReminderPolicy(organizationId),
    enabled: Boolean(organizationId),
  });
}

export function useUpdateReminderPolicy(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SchedulingReminderPolicyPatch) => updateReminderPolicy(organizationId, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reminderPolicyKey(organizationId) }),
  });
}

export function useCalendarFeedTokens(organizationId: string) {
  return useQuery({
    queryKey: feedTokensKey(organizationId),
    queryFn: () => fetchCalendarFeedTokens(organizationId),
    enabled: Boolean(organizationId),
  });
}

export function useGenerateCalendarFeedToken(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => generateCalendarFeedToken(organizationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: feedTokensKey(organizationId) }),
  });
}

export function useRevokeCalendarFeedToken(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => revokeCalendarFeedToken(organizationId, tokenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: feedTokensKey(organizationId) }),
  });
}

/** Fetched once alongside the Calendar page's existing appointments
    query — never a second polling loop (see `app/api/calendar-sync/
    links/route.ts`'s own comment). */
export function useCalendarSyncLinks(organizationId: string) {
  return useQuery({
    queryKey: syncLinksKey(organizationId),
    queryFn: () => fetchCalendarSyncLinks(organizationId),
    enabled: Boolean(organizationId),
  });
}
