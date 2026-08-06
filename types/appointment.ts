/**
 * Phase 27 (Scheduling & Resource Management). An `Appointment` represents
 * *work being scheduled* — a case-facing or internal event with a type, a
 * time window, and a status. It carries **zero resource state**: no
 * embedded resource name, no resource-type flag, no assignment array.
 * Every resource relationship (staff, vehicle, room, equipment, vendor)
 * flows exclusively through `AppointmentResourceAssignment`
 * (types/appointmentResourceAssignment.ts) — never a field on this type.
 * See docs/adr/ADR-031-scheduling-and-resource-management.md.
 */

/**
 * Draft is a real, meaningful state (mirroring the draft -> pending
 * two-phase pattern already proven for SignatureRequest): an appointment
 * is inserted as Draft when resources aren't yet finalized, and advances
 * to Scheduled only once conflict-checked resource assignments succeed.
 * Confirmed/InProgress are optional, explicit staff transitions.
 * Completed/Cancelled/NoShow are terminal — once reached, the row is
 * never edited again. This state machine is authoritative and
 * independent of the ActivityService audit log: events narrate
 * transitions, they are never queried to determine current status.
 */
export type AppointmentStatus = 'draft' | 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

const TERMINAL_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ['completed', 'cancelled', 'no_show'];

export function isTerminalAppointmentStatus(status: AppointmentStatus): boolean {
  return TERMINAL_APPOINTMENT_STATUSES.includes(status);
}

export type Appointment = {
  id: string;
  organizationId: string;
  /** Null for pure internal/staff appointments with no case connection. */
  caseId: string | null;
  /** A domain/scheduling/appointmentTypeRegistry.ts APPOINTMENT_TYPES[...].key
      — validated at the service boundary, never a hardcoded union here
      (mirrors CaseDocument.documentTypeKey's exact convention). */
  appointmentType: string;
  title: string;
  notes: string | null;
  /** -> OrganizationLocation.id, optional. Address-level context only —
      never a Resource; a specific bookable room/chapel is always a
      Resource, assigned via AppointmentResourceAssignment. */
  locationId: string | null;
  status: AppointmentStatus;
  startAt: string;
  endAt: string;
  /** IANA timezone name; defaults from Organization.timezone at creation,
      overridable per appointment. */
  timezone: string;
  /** -> RecurrenceDefinition.id. Null for a non-recurring appointment. */
  recurrenceDefinitionId: string | null;
  /** True once this specific occurrence has been individually edited
      (time changed, cancelled, notes changed) independent of the rest of
      its series — the RecurrenceDefinition and every sibling occurrence
      remain untouched regardless. */
  isRecurrenceException: boolean;
  /** Phase 30 (Identity Model Hardening & Staff Assignment Unification).
      -> StaffProfile.id. "Who is primarily responsible for this
      appointment" — an operational-assignment field, deliberately
      distinct from generic resource-checking (a staff member can be a
      checked `Resource` on this appointment without being its owner, and
      vice versa; see ADR-034). Additive, nullable — every pre-Phase-30
      row simply has no owner. Never `Identity.id` directly — see this
      codebase's hard layering invariant (types/staffProfile.ts's own
      header comment). */
  ownerStaffProfileId: string | null;
  createdBy: string;
  /** The first "generic last-editor" field in this codebase — justified
      specifically because an Appointment, unlike CaseDocument/
      SignatureRequest, is genuinely edited multiple times before reaching
      a terminal state, rather than having a handful of named,
      single-purpose actor fields like cancelledBy. Null until the first
      edit after creation. */
  lastModifiedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  /** Schema-evolution reserve, mirrors SignatureRequest.requestVersion
      exactly — starts at 1. */
  appointmentVersion: number;
  /** Shared with every ActivityEvent this appointment's own actions produce. */
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

export type NewAppointmentInput = {
  caseId?: string;
  appointmentType: string;
  title: string;
  notes?: string;
  locationId?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  /** Resource ids to assign at creation time — validated and conflict-checked
      by services/schedulingService.ts, never embedded on the Appointment
      row itself. */
  resourceIds?: string[];
  /** -> StaffProfile.id. Optional — validated via
      `services/staffProfileService.ts#assertAssignableStaffProfile`
      (`schedule.edit` permission) before being accepted. */
  ownerStaffProfileId?: string;
  saveAsDraft?: boolean;
  recurrence?: { frequency: 'daily' | 'weekly' | 'monthly'; interval: number; byWeekday?: number[]; count?: number; until?: string };
  override?: { reason: string };
};
