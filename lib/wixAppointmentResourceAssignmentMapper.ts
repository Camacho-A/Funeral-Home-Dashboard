import type { AppointmentResourceAssignment } from '../types/appointmentResourceAssignment';
import type { AppointmentStatus } from '../types/appointment';

/**
 * Phase 27 (Scheduling & Resource Management). Standard mapper pair for
 * the `appointmentResourceAssignments` collection — the one and only
 * bridge between an Appointment and a Resource (see
 * types/appointmentResourceAssignment.ts's own header comment). Written
 * only from services/schedulingService.ts; read from both there and
 * services/resourceService.ts's `getAvailability`.
 */

export type WixAppointmentResourceAssignmentItem = {
  beaconAssignmentId?: unknown;
  organizationId?: unknown;
  appointmentId?: unknown;
  resourceId?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  status?: unknown;
  assignmentRole?: unknown;
  assignedAt?: unknown;
  releasedAt?: unknown;
  createdBy?: unknown;
};

const VALID_STATUSES: readonly string[] = ['draft', 'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];

function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixAppointmentResourceAssignmentItem(item: WixAppointmentResourceAssignmentItem | undefined): AppointmentResourceAssignment | null {
  if (
    !item ||
    typeof item.beaconAssignmentId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.appointmentId !== 'string' ||
    typeof item.resourceId !== 'string' ||
    typeof item.startAt !== 'string' ||
    typeof item.endAt !== 'string' ||
    !isAppointmentStatus(item.status) ||
    !isStringOrNull(item.assignmentRole) ||
    typeof item.assignedAt !== 'string' ||
    !isStringOrNull(item.releasedAt) ||
    typeof item.createdBy !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconAssignmentId,
    organizationId: item.organizationId,
    appointmentId: item.appointmentId,
    resourceId: item.resourceId,
    startAt: item.startAt,
    endAt: item.endAt,
    status: item.status,
    assignmentRole: item.assignmentRole,
    assignedAt: item.assignedAt,
    releasedAt: item.releasedAt,
    createdBy: item.createdBy,
  };
}

export function buildWixAppointmentResourceAssignmentData(assignment: AppointmentResourceAssignment): WixAppointmentResourceAssignmentItem {
  return {
    beaconAssignmentId: assignment.id,
    organizationId: assignment.organizationId,
    appointmentId: assignment.appointmentId,
    resourceId: assignment.resourceId,
    startAt: assignment.startAt,
    endAt: assignment.endAt,
    status: assignment.status,
    assignmentRole: assignment.assignmentRole,
    assignedAt: assignment.assignedAt,
    releasedAt: assignment.releasedAt,
    createdBy: assignment.createdBy,
  };
}

/** The only fields ever changed on an already-inserted assignment row:
    the denormalized `startAt`/`endAt`/`status` copy (on reschedule/
    status-change) and `releasedAt` (on release). */
export function applyAppointmentResourceAssignmentUpdateToWixData(
  existing: WixAppointmentResourceAssignmentItem,
  patch: Partial<Pick<WixAppointmentResourceAssignmentItem, 'startAt' | 'endAt' | 'status' | 'releasedAt'>>,
): WixAppointmentResourceAssignmentItem {
  return { ...existing, ...patch };
}
