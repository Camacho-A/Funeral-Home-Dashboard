import type { DataAdapterMode } from '../../lib/env';
import { listForCase } from '../activityService';
import { isFamilyVisibleEventType, buildPortalActivityView, type PortalActivityView } from '../../domain/portal/portalActivityView';

/**
 * Phase 29 (Family Portal & External Collaboration). A thin wrapper over
 * `services/activityService.ts`'s existing `listForCase` — never a
 * second audit system, never a new write path (this file has no writer
 * of any kind). Filters each returned page down to
 * `FAMILY_VISIBLE_EVENT_TYPES` before mapping through the allowlisting
 * DTO, so a page may legitimately return fewer visible events than
 * `limit` — the underlying cursor still advances correctly for the next
 * call, exactly like any other filtered-after-fetch read in this
 * codebase.
 */
export type PortalActivityListResult = { events: PortalActivityView[]; nextCursor: string | null };

export async function listFamilyActivity(
  organizationId: string,
  caseId: string,
  cursorRaw: string | null,
  limit: number,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalActivityListResult> {
  const page = await listForCase(organizationId, caseId, cursorRaw, limit, dataAdapterMode);
  return {
    events: page.events.filter((e) => isFamilyVisibleEventType(e.eventType)).map(buildPortalActivityView),
    nextCursor: page.nextCursor,
  };
}
