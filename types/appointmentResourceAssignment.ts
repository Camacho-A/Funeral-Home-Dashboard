import type { AppointmentStatus } from './appointment';

/**
 * Phase 27 (Scheduling & Resource Management). The one and only bridge
 * between an `Appointment` and a `Resource` — every assignment, release,
 * and conflict check flows through this join table exclusively. Under
 * Wix Data's no-real-joins constraint, `startAt`/`endAt`/`status` are
 * denormalized from the parent `Appointment` at write time, so a single
 * `(organizationId, resourceId)`-indexed query returns every candidate
 * booking for a resource without a second round-trip. Refreshed only by
 * services/schedulingService.ts's own reschedule/cancel/complete paths —
 * no other file ever writes to this collection directly.
 * See docs/adr/ADR-031-scheduling-and-resource-management.md.
 */
export type AppointmentResourceAssignment = {
  id: string;
  organizationId: string;
  appointmentId: string;
  resourceId: string;
  /** Denormalized copy of Appointment.startAt at write time. */
  startAt: string;
  /** Denormalized copy of Appointment.endAt at write time. */
  endAt: string;
  /** Denormalized copy of Appointment.status at write time — lets a
      conflict check skip a second lookup against the appointments
      collection. */
  status: AppointmentStatus;
  /** e.g. "primary director" vs "assisting staff." Optional, descriptive only. */
  assignmentRole: string | null;
  assignedAt: string;
  releasedAt: string | null;
  createdBy: string;
};
