import type { ActivityListFilters } from '@/services/activityService';
import { isValidActivityCategory, isValidActivitySeverity } from '@/lib/wixActivityEventMapper';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). Shared between
 * `GET /api/activity` and `GET /api/activity/export` — a Next.js App
 * Router `route.ts` file may only export recognized route handlers
 * (GET/POST/etc.), so this parsing logic lives here instead of being
 * exported from either route file directly.
 */
export function parseActivityFilters(searchParams: URLSearchParams): { filters: ActivityListFilters; error: string | null } {
  const filters: ActivityListFilters = {};

  const caseId = searchParams.get('caseId');
  if (caseId) filters.caseId = caseId;

  const category = searchParams.get('category');
  if (category) {
    if (!isValidActivityCategory(category)) return { filters, error: `Invalid category: ${category}` };
    filters.category = category;
  }

  const severity = searchParams.get('severity');
  if (severity) {
    if (!isValidActivitySeverity(severity)) return { filters, error: `Invalid severity: ${severity}` };
    filters.severity = severity;
  }

  const resourceType = searchParams.get('resourceType');
  if (resourceType) filters.resourceType = resourceType;

  const eventType = searchParams.get('eventType');
  if (eventType) filters.eventType = eventType;

  const actorIdentityId = searchParams.get('actorIdentityId');
  if (actorIdentityId) filters.actorIdentityId = actorIdentityId;

  const query = searchParams.get('q');
  if (query) filters.query = query;

  const from = searchParams.get('from');
  if (from) filters.from = from;

  const to = searchParams.get('to');
  if (to) filters.to = to;

  return { filters, error: null };
}
