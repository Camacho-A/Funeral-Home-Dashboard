import type { DataAdapterMode } from '../../lib/env';
import { queryWixDataItems } from '../../lib/wixDataApi';
import { mapWixAppointmentItem, type WixAppointmentItem } from '../../lib/wixAppointmentMapper';
import { mapWixAppointmentResourceAssignmentItem, type WixAppointmentResourceAssignmentItem } from '../../lib/wixAppointmentResourceAssignmentMapper';
import type { Appointment, AppointmentStatus } from '../../types/appointment';
import type { AppointmentResourceAssignment } from '../../types/appointmentResourceAssignment';
import { appointmentFixtures, appointmentResourceAssignmentFixtures } from '../__mocks__/schedulingFixtures';

/**
 * Phase 27 (Scheduling & Resource Management). The pure, read-only half
 * of appointment access — deliberately factored out of
 * `services/schedulingService.ts` so `services/documentService.ts` can
 * read appointment data for the merge engine's `case.service.date`/
 * `case.service.location` fields (see `domain/documents/mergeEngine.ts`)
 * without creating an import cycle: `schedulingService.ts` imports
 * `services/signatureService.ts` (for the witness-signature integration),
 * which itself imports `documentService.ts` — so `documentService.ts`
 * can never import `schedulingService.ts` directly. This file has no
 * dependency on either of those, so both `schedulingService.ts` and
 * `documentService.ts` import from here instead, breaking the cycle.
 * Every write to `appointments`/`appointmentResourceAssignments` still
 * happens exclusively in `schedulingService.ts` — this file only ever
 * reads.
 */

export async function listAppointments(
  organizationId: string,
  filters: { from?: string; to?: string; caseId?: string; status?: AppointmentStatus; resourceId?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Appointment[]> {
  let candidates: Appointment[];
  if (dataAdapterMode === 'mock') {
    candidates = appointmentFixtures.filter((a) => a.organizationId === organizationId);
  } else {
    const wixFilter: Record<string, unknown> = { organizationId };
    if (filters.caseId) wixFilter.caseId = filters.caseId;
    if (filters.status) wixFilter.status = filters.status;
    const response = await queryWixDataItems<WixAppointmentItem>('appointments', { filter: wixFilter });
    candidates = response.dataItems.map((item) => mapWixAppointmentItem(item.data)).filter((a): a is Appointment => a !== null);
  }

  let filtered = candidates.filter(
    (a) =>
      (filters.caseId === undefined || a.caseId === filters.caseId) &&
      (filters.status === undefined || a.status === filters.status) &&
      (filters.from === undefined || a.endAt > filters.from) &&
      (filters.to === undefined || a.startAt < filters.to),
  );

  if (filters.resourceId) {
    const assignments =
      dataAdapterMode === 'mock'
        ? appointmentResourceAssignmentFixtures.filter((a) => a.organizationId === organizationId && a.resourceId === filters.resourceId && a.releasedAt === null)
        : (await queryWixDataItems<WixAppointmentResourceAssignmentItem>('appointmentResourceAssignments', { filter: { organizationId, resourceId: filters.resourceId } })).dataItems
            .map((item) => mapWixAppointmentResourceAssignmentItem(item.data))
            .filter((a): a is AppointmentResourceAssignment => a !== null && a.releasedAt === null);
    const appointmentIds = new Set(assignments.map((a) => a.appointmentId));
    filtered = filtered.filter((a) => appointmentIds.has(a.id));
  }

  return filtered.sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
}

export async function getAppointment(organizationId: string, appointmentId: string, dataAdapterMode: DataAdapterMode): Promise<Appointment | null> {
  if (dataAdapterMode === 'mock') {
    return appointmentFixtures.find((a) => a.id === appointmentId && a.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixAppointmentItem>('appointments', { filter: { organizationId, beaconAppointmentId: appointmentId }, paging: { limit: 1 } });
  return mapWixAppointmentItem(response.dataItems[0]?.data);
}

export async function listAppointmentsForCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<Appointment[]> {
  return listAppointments(organizationId, { caseId }, dataAdapterMode);
}
