import type { Appointment, AppointmentStatus } from '../types/appointment';

/**
 * Phase 27 (Scheduling & Resource Management). Standard mapper pair for
 * the `appointments` collection. A single scoped patch function (not
 * several near-identical narrow ones) — mirrors
 * `lib/wixSignatureRequestMapper.ts`'s own `applySignatureRequestPatchToWixData`
 * precedent exactly, for the identical reason: a workflow transition here
 * routinely sets more than one field together (status + cancelledAt/
 * cancelledBy/cancelReason on cancel; startAt/endAt/isRecurrenceException
 * on a single-occurrence reschedule) — never a fully generic "any field"
 * patch, only the fields this type declares.
 */

export type WixAppointmentItem = {
  beaconAppointmentId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  appointmentType?: unknown;
  title?: unknown;
  notes?: unknown;
  locationId?: unknown;
  status?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  timezone?: unknown;
  recurrenceDefinitionId?: unknown;
  isRecurrenceException?: unknown;
  createdBy?: unknown;
  lastModifiedBy?: unknown;
  cancelledAt?: unknown;
  cancelledBy?: unknown;
  cancelReason?: unknown;
  appointmentVersion?: unknown;
  correlationId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_STATUSES: readonly string[] = ['draft', 'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];

function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixAppointmentItem(item: WixAppointmentItem | undefined): Appointment | null {
  if (
    !item ||
    typeof item.beaconAppointmentId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    !isStringOrNull(item.caseId) ||
    typeof item.appointmentType !== 'string' ||
    typeof item.title !== 'string' ||
    !isStringOrNull(item.notes) ||
    !isStringOrNull(item.locationId) ||
    !isAppointmentStatus(item.status) ||
    typeof item.startAt !== 'string' ||
    typeof item.endAt !== 'string' ||
    typeof item.timezone !== 'string' ||
    !isStringOrNull(item.recurrenceDefinitionId) ||
    typeof item.isRecurrenceException !== 'boolean' ||
    typeof item.createdBy !== 'string' ||
    !isStringOrNull(item.lastModifiedBy) ||
    !isStringOrNull(item.cancelledAt) ||
    !isStringOrNull(item.cancelledBy) ||
    !isStringOrNull(item.cancelReason) ||
    typeof item.appointmentVersion !== 'number' ||
    typeof item.correlationId !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconAppointmentId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    appointmentType: item.appointmentType,
    title: item.title,
    notes: item.notes,
    locationId: item.locationId,
    status: item.status,
    startAt: item.startAt,
    endAt: item.endAt,
    timezone: item.timezone,
    recurrenceDefinitionId: item.recurrenceDefinitionId,
    isRecurrenceException: item.isRecurrenceException,
    createdBy: item.createdBy,
    lastModifiedBy: item.lastModifiedBy,
    cancelledAt: item.cancelledAt,
    cancelledBy: item.cancelledBy,
    cancelReason: item.cancelReason,
    appointmentVersion: item.appointmentVersion,
    correlationId: item.correlationId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixAppointmentData(appointment: Appointment): WixAppointmentItem {
  return {
    beaconAppointmentId: appointment.id,
    organizationId: appointment.organizationId,
    caseId: appointment.caseId,
    appointmentType: appointment.appointmentType,
    title: appointment.title,
    notes: appointment.notes,
    locationId: appointment.locationId,
    status: appointment.status,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    timezone: appointment.timezone,
    recurrenceDefinitionId: appointment.recurrenceDefinitionId,
    isRecurrenceException: appointment.isRecurrenceException,
    createdBy: appointment.createdBy,
    lastModifiedBy: appointment.lastModifiedBy,
    cancelledAt: appointment.cancelledAt,
    cancelledBy: appointment.cancelledBy,
    cancelReason: appointment.cancelReason,
    appointmentVersion: appointment.appointmentVersion,
    correlationId: appointment.correlationId,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

export function applyAppointmentPatchToWixData(existing: WixAppointmentItem, patch: Partial<WixAppointmentItem>): WixAppointmentItem {
  return { ...existing, ...patch };
}
