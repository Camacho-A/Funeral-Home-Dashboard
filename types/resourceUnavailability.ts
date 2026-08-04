/**
 * Phase 27 (Scheduling & Resource Management). A time-bounded exception on
 * an otherwise-bookable `Resource` — deliberately NOT modeled as a fake
 * internal `Appointment` (which would pollute every appointment list/UI
 * with non-events). Complementary to `Resource.status`, not redundant
 * with it: `status` answers "is this resource generally usable"; a
 * `ResourceUnavailability` row answers "is this resource free at this
 * specific moment." Checked by the identical overlap logic
 * services/scheduling/conflictEngine.ts already uses for
 * `AppointmentResourceAssignment` — an overlapping window here is always a
 * hard conflict. See docs/adr/ADR-031-scheduling-and-resource-management.md.
 */
export type ResourceUnavailabilityReason = 'maintenance' | 'time_off' | 'other';

export type ResourceUnavailability = {
  id: string;
  organizationId: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  reason: ResourceUnavailabilityReason;
  notes: string | null;
  createdBy: string;
  createdAt: string;
};

export type NewResourceUnavailabilityInput = {
  resourceId: string;
  startAt: string;
  endAt: string;
  reason: ResourceUnavailabilityReason;
  notes?: string;
};
