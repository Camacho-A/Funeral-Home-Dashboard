import type { DataAdapterMode } from '../../lib/env';
import { get as getResource, getAvailability } from '../resourceService';

/**
 * Phase 27 (Scheduling & Resource Management). Imported only by
 * `services/schedulingService.ts` (structurally enforced — see that
 * file's own test). Pure detection logic + reads via
 * `services/resourceService.ts`'s `getAvailability`/`get` — no writes of
 * any kind, and no decision here is ever final: `schedulingService.ts`
 * decides whether a hard conflict blocks the save or an authorized
 * override proceeds.
 */
export class ConflictEngineError extends Error {}

export type ConflictReason =
  | 'overlapping_assignment'
  | 'overlapping_unavailability'
  | 'resource_out_of_service'
  | 'resource_archived'
  | 'resource_maintenance'
  | 'buffer_window';

export type ConflictDetail = {
  resourceId: string;
  resourceName: string;
  reason: ConflictReason;
  conflictingAppointmentId: string | null;
  conflictingWindow: { startAt: string; endAt: string } | null;
};

const DEFAULT_BUFFER_MINUTES = 15;

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Hard: an overlapping active assignment, an overlapping unavailability
    window, or the resource being fundamentally unbookable
    (`out_of_service`/`archived`), regardless of time. Soft: the
    resource is `maintenance`, or the requested window falls inside a
    buffer/turnaround gap immediately adjacent to another booking for the
    same resource. External resources (Beacon does not operate them) are
    never conflict-checked at all. */
export async function checkConflicts(
  organizationId: string,
  resourceIds: string[],
  startAt: string,
  endAt: string,
  dataAdapterMode: DataAdapterMode,
  options: { excludeAppointmentId?: string; bufferMinutes?: number } = {},
): Promise<{ hardConflicts: ConflictDetail[]; softConflicts: ConflictDetail[] }> {
  const bufferMinutes = options.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  const hardConflicts: ConflictDetail[] = [];
  const softConflicts: ConflictDetail[] = [];

  for (const resourceId of resourceIds) {
    const resource = await getResource(organizationId, resourceId, dataAdapterMode);
    if (!resource) {
      throw new ConflictEngineError(`Resource "${resourceId}" not found.`);
    }
    if (resource.isExternal) continue;

    if (resource.status === 'out_of_service' || resource.status === 'archived') {
      hardConflicts.push({
        resourceId,
        resourceName: resource.name,
        reason: resource.status === 'out_of_service' ? 'resource_out_of_service' : 'resource_archived',
        conflictingAppointmentId: null,
        conflictingWindow: null,
      });
      continue;
    }

    if (resource.status === 'maintenance') {
      softConflicts.push({ resourceId, resourceName: resource.name, reason: 'resource_maintenance', conflictingAppointmentId: null, conflictingWindow: null });
    }

    const { assignments, unavailability } = await getAvailability(organizationId, resourceId, startAt, endAt, dataAdapterMode);
    for (const assignment of assignments) {
      if (options.excludeAppointmentId && assignment.appointmentId === options.excludeAppointmentId) continue;
      hardConflicts.push({
        resourceId,
        resourceName: resource.name,
        reason: 'overlapping_assignment',
        conflictingAppointmentId: assignment.appointmentId,
        conflictingWindow: { startAt: assignment.startAt, endAt: assignment.endAt },
      });
    }
    for (const window of unavailability) {
      hardConflicts.push({
        resourceId,
        resourceName: resource.name,
        reason: 'overlapping_unavailability',
        conflictingAppointmentId: null,
        conflictingWindow: { startAt: window.startAt, endAt: window.endAt },
      });
    }

    if (bufferMinutes > 0) {
      const bufferedFrom = addMinutes(startAt, -bufferMinutes);
      const bufferedTo = addMinutes(endAt, bufferMinutes);
      const { assignments: bufferedAssignments } = await getAvailability(organizationId, resourceId, bufferedFrom, bufferedTo, dataAdapterMode);
      for (const assignment of bufferedAssignments) {
        if (options.excludeAppointmentId && assignment.appointmentId === options.excludeAppointmentId) continue;
        const overlapsExactWindow = assignment.startAt < endAt && assignment.endAt > startAt;
        if (overlapsExactWindow) continue; // already a hard conflict above, not also a soft one
        softConflicts.push({
          resourceId,
          resourceName: resource.name,
          reason: 'buffer_window',
          conflictingAppointmentId: assignment.appointmentId,
          conflictingWindow: { startAt: assignment.startAt, endAt: assignment.endAt },
        });
      }
    }
  }

  return { hardConflicts, softConflicts };
}
