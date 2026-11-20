import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { SERVICE_PREPARATION_DEFINITIONS, servicePreparationFor } from '../domain/servicePreparation/serviceDefinitions';
import { selectServiceEvent, summarizeServiceReadiness } from '../domain/servicePreparation/readiness';
import { isReleasedStatus, releaseStatusOf } from '../domain/servicePreparation/releaseHolds';
import type { DataAdapterMode } from '../lib/env';
import { listAppointments } from './scheduling/appointmentReads';
import { loadCaseOnServer } from './serverCaseLoader';

/**
 * Upcoming services (Gus Phase 5L, 2026-11): every Viewing / Final Goodbye
 * in the window, with its preparation progress and release state, for the
 * dashboard. Read-only. Only organizations with service preparation (Gus);
 * null otherwise. Organization-scoped: appointments and cases are read for
 * the caller's organization only.
 */
export type UpcomingServiceSummary = {
  caseId: string;
  caseNumber: string;
  decedentName: string;
  serviceName: string;
  startAt: string;
  endAt: string;
  status: string;
  /** Preparation steps done, of those that apply. */
  completed: number;
  total: number;
  /** Steps past their deadline. */
  overdue: number;
  /** Still has to happen before the service is ready. */
  blocking: number;
  ready: boolean;
  /** Cremation waits for this service and it has not been released yet. */
  awaitingRelease: boolean;
  released: boolean;
  /** Released, then placed on hold (2026-11). */
  onHold: boolean;
};

const DAY = 24 * 60 * 60 * 1000;
export const UPCOMING_SERVICES_DAYS_AHEAD = 14;
/** Services held recently that are not yet released stay on the list. */
export const UPCOMING_SERVICES_DAYS_BEHIND = 7;
const MAX_CASES = 50;

export async function listUpcomingServices(organizationId: string, mode: DataAdapterMode, now = new Date().toISOString()): Promise<UpcomingServiceSummary[] | null> {
  if (!getRegisteredOrganizationProfile(organizationId).features.servicePreparation) return null;
  const at = Date.parse(now);
  const serviceTypes = new Set(SERVICE_PREPARATION_DEFINITIONS.filter((d) => d.status !== 'draft').map((d) => d.serviceAppointmentType));
  const appointments = (
    await listAppointments(organizationId, { from: new Date(at - UPCOMING_SERVICES_DAYS_BEHIND * DAY).toISOString(), to: new Date(at + UPCOMING_SERVICES_DAYS_AHEAD * DAY).toISOString() }, mode)
  ).filter((a) => a.organizationId === organizationId && a.caseId && serviceTypes.has(a.appointmentType) && a.status !== 'cancelled' && a.status !== 'no_show');
  const caseIds = [...new Set(appointments.map((a) => a.caseId as string))].slice(0, MAX_CASES);

  const summaries = await Promise.all(
    caseIds.map(async (caseId): Promise<UpcomingServiceSummary | null> => {
      const case_ = await loadCaseOnServer(organizationId, caseId, mode);
      if (!case_ || case_.organizationId !== organizationId || case_.isDeleted) return null;
      const definition = servicePreparationFor(case_.workflowSnapshot?.serviceTypeCode);
      if (!definition || definition.status === 'draft') return null;
      const service = selectServiceEvent(appointments, { organizationId, caseId, appointmentType: definition.serviceAppointmentType });
      if (!service) return null;
      const record = case_.servicePreparation && case_.servicePreparation.definitionKey === definition.key ? case_.servicePreparation : null;
      const readiness = summarizeServiceReadiness({ definition, record, service, now });
      const status = releaseStatusOf(record);
      const released = isReleasedStatus(status);
      const onHold = status === 'on_hold' || status === 'awaiting_reauthorization';
      // A completed service drops off once released (or if cremation doesn't wait for it).
      if (service.status === 'completed' && (released || readiness.holdsCremation === false)) return null;
      const applicable = readiness.items.filter((i) => i.status !== 'not_requested');
      return {
        caseId,
        caseNumber: case_.caseNumber,
        decedentName: case_.decedentName,
        serviceName: definition.serviceName,
        startAt: service.startAt,
        endAt: service.endAt,
        status: service.status,
        completed: applicable.filter((i) => i.done).length,
        total: applicable.length,
        overdue: applicable.filter((i) => !i.done && i.deadline?.state === 'overdue').length,
        blocking: applicable.filter((i) => i.blocking).length,
        ready: readiness.ready,
        awaitingRelease: readiness.holdsCremation !== false && !released,
        released,
        onHold,
      };
    }),
  );
  return summaries.filter((s): s is UpcomingServiceSummary => s !== null).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}
