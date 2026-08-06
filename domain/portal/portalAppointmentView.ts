import type { Appointment } from '../../types/appointment';

/**
 * Phase 29 (Family Portal & External Collaboration). An explicit
 * allowlisting DTO — the family-facing shape of an `Appointment`, gated
 * by `appointment.read`. Never a raw `Appointment`: excludes `notes`
 * (staff-only), `recurrenceDefinitionId`/`isRecurrenceException`
 * (internal scheduling detail), `createdBy`/`lastModifiedBy`/
 * `cancelledBy` (staff-Identity-space), `appointmentVersion`/
 * `correlationId` (internal bookkeeping), and `organizationId`/`caseId`
 * (redundant — already scoped by the route). `cancelledAt`/`cancelReason`
 * are kept — a family member reasonably needs to know an appointment was
 * cancelled and why.
 */
export type PortalAppointmentView = {
  id: string;
  appointmentType: string;
  title: string;
  locationId: string | null;
  status: string;
  startAt: string;
  endAt: string;
  timezone: string;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export function buildPortalAppointmentView(appointment: Appointment): PortalAppointmentView {
  return {
    id: appointment.id,
    appointmentType: appointment.appointmentType,
    title: appointment.title,
    locationId: appointment.locationId,
    status: appointment.status,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    timezone: appointment.timezone,
    cancelledAt: appointment.cancelledAt,
    cancelReason: appointment.cancelReason,
  };
}
