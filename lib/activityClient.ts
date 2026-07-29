import type { ActivityEvent, ActivityEventCategory, ActivitySeverity } from '@/types/activityEvent';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). Client-side fetch
 * wrappers around `/api/cases/[caseId]/activity`, `/api/activity`, and
 * `/api/activity/export` — the Case Activity tab's and Audit Center's only
 * path to the server, matching every other `lib/*Client.ts` module's
 * reasoning (see lib/identityAuthClient.ts's own header comment):
 * `services/activityService.ts` imports `lib/wixDataApi.ts` (server-only,
 * holds WIX_API_KEY) and can never be imported into a Client Component.
 */

export type ActivityFilters = {
  category?: ActivityEventCategory;
  severity?: ActivitySeverity;
  from?: string;
  to?: string;
  q?: string;
};

export type ActivityPage = { events: ActivityEvent[]; nextCursor: string | null };

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

function filtersToParams(organizationId: string, filters: ActivityFilters): URLSearchParams {
  const params = new URLSearchParams({ organizationId });
  if (filters.category) params.set('category', filters.category);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.q) params.set('q', filters.q);
  return params;
}

export async function fetchCaseActivity(caseId: string, organizationId: string, cursor: string | null): Promise<ActivityPage> {
  const params = new URLSearchParams({ organizationId });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/activity?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return { events: (body.events as ActivityEvent[]) ?? [], nextCursor: (body.nextCursor as string | null) ?? null };
}

export async function fetchOrganizationActivity(organizationId: string, filters: ActivityFilters, cursor: string | null): Promise<ActivityPage> {
  const params = filtersToParams(organizationId, filters);
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/activity?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return { events: (body.events as ActivityEvent[]) ?? [], nextCursor: (body.nextCursor as string | null) ?? null };
}

/**
 * Not a fetch wrapper — the export route returns a raw CSV file
 * (`Content-Disposition: attachment`), so the simplest correct client
 * trigger is navigating the browser to this URL directly (e.g.
 * `window.location.href = buildActivityExportUrl(...)`), which downloads
 * the file without leaving the current page. No blob/fetch dance needed.
 */
export function buildActivityExportUrl(organizationId: string, filters: ActivityFilters): string {
  const params = filtersToParams(organizationId, filters);
  return `/api/activity/export?${params.toString()}`;
}
