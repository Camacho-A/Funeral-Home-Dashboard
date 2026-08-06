import type { DataAdapterMode } from '../../lib/env';
import { listAppointmentsForCase } from '../scheduling/appointmentReads';
import { buildPortalAppointmentView, type PortalAppointmentView } from '../../domain/portal/portalAppointmentView';

/**
 * Phase 29 (Family Portal & External Collaboration). A thin wrapper —
 * `services/scheduling/appointmentReads.ts`'s `listAppointmentsForCase` is
 * already a pure, case-scoped read with no RBAC embedded, so this file's
 * entire job is mapping its result through the allowlisting DTO. No
 * appointment-creation, rescheduling, or cancellation capability exists
 * here — refinement #15 (no family-side rescheduling).
 */
export async function listFamilyAppointments(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<PortalAppointmentView[]> {
  const appointments = await listAppointmentsForCase(organizationId, caseId, dataAdapterMode);
  return appointments.map(buildPortalAppointmentView);
}
