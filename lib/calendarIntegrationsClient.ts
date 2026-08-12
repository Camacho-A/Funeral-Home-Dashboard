import type { CalendarConnection, CalendarProviderName } from '@/types/calendarConnection';
import type { CalendarFeedToken } from '@/types/calendarFeedToken';
import type { CalendarEventLink } from '@/types/calendarEventLink';
import type { SchedulingReminderPolicy, SchedulingReminderPolicyPatch } from '@/types/schedulingReminderPolicy';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Client-side fetch wrappers around the calendar-connection/
 * feed-token/reminder-policy/sync-status routes — mirrors
 * `lib/notificationsClient.ts`'s exact shape (a thin, typed wrapper per
 * route, `parseJsonOrThrow`'s error-surfacing convention duplicated
 * locally rather than shared, matching every other `lib/*Client.ts`
 * module in this codebase).
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchCalendarConnections(organizationId: string, scope?: 'organization'): Promise<CalendarConnection[]> {
  const params = new URLSearchParams({ organizationId, ...(scope ? { scope } : {}) });
  const response = await fetch(`/api/calendar-connections?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.connections as CalendarConnection[]) ?? [];
}

export async function disconnectCalendarConnection(organizationId: string, connectionId: string): Promise<CalendarConnection> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/calendar-connections/${encodeURIComponent(connectionId)}?${params.toString()}`, { method: 'DELETE' });
  const body = await parseJsonOrThrow(response);
  return body.connection as CalendarConnection;
}

export async function beginCalendarConnect(organizationId: string, provider: CalendarProviderName): Promise<string> {
  const response = await fetch(`/api/calendar-connections/${provider}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body.authorizeUrl as string;
}

export async function fetchReminderPolicy(organizationId: string): Promise<SchedulingReminderPolicy> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/scheduling/reminder-policy?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return body.policy as SchedulingReminderPolicy;
}

export async function updateReminderPolicy(organizationId: string, patch: SchedulingReminderPolicyPatch): Promise<SchedulingReminderPolicy> {
  const response = await fetch('/api/scheduling/reminder-policy', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, ...patch }),
  });
  const body = await parseJsonOrThrow(response);
  return body.policy as SchedulingReminderPolicy;
}

export async function fetchCalendarFeedTokens(organizationId: string): Promise<CalendarFeedToken[]> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/calendar-feed-tokens?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.tokens as CalendarFeedToken[]) ?? [];
}

export type GeneratedFeedTokenResponse = { token: CalendarFeedToken; rawToken: string };

export async function generateCalendarFeedToken(organizationId: string): Promise<GeneratedFeedTokenResponse> {
  const response = await fetch('/api/calendar-feed-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body as unknown as GeneratedFeedTokenResponse;
}

export async function revokeCalendarFeedToken(organizationId: string, tokenId: string): Promise<CalendarFeedToken> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/calendar-feed-tokens/${encodeURIComponent(tokenId)}?${params.toString()}`, { method: 'DELETE' });
  const body = await parseJsonOrThrow(response);
  return body.token as CalendarFeedToken;
}

export async function fetchCalendarSyncLinks(organizationId: string): Promise<CalendarEventLink[]> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/calendar-sync/links?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.links as CalendarEventLink[]) ?? [];
}
