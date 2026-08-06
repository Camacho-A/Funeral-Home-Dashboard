/**
 * Phase 27 (Scheduling & Resource Management). A `Resource` is *a thing
 * that can be assigned to work* — staff, a vehicle, a room, equipment, an
 * external vendor. It carries no reference to any specific `Appointment`;
 * every assignment flows exclusively through `AppointmentResourceAssignment`
 * (types/appointmentResourceAssignment.ts). See
 * docs/adr/ADR-031-scheduling-and-resource-management.md.
 */

export type ResourceType =
  | 'funeral_director'
  | 'staff'
  | 'vehicle'
  | 'chapel'
  | 'viewing_room'
  | 'meeting_room'
  | 'crematory'
  | 'cemetery'
  | 'equipment'
  | 'external_vendor';

/**
 * A lifecycle state, not a boolean — `active`/`maintenance` are both
 * bookable (maintenance produces a soft, warning-only conflict);
 * `out_of_service`/`archived` are both hard-blocked from any new booking.
 * See services/scheduling/conflictEngine.ts for exactly how each value is
 * treated.
 */
export type ResourceStatus = 'active' | 'maintenance' | 'out_of_service' | 'archived';

export type Resource = {
  id: string;
  organizationId: string;
  /** -> OrganizationLocation.id, optional. Address-level context only —
      OrganizationLocation itself is never touched by this phase. */
  locationId: string | null;
  resourceType: ResourceType;
  name: string;
  /** -> Membership.id. Set only for 'staff'/'funeral_director' rows — the
      one and only connection this row has to RBAC/identity. Role,
      permission, and account status always resolve through the real
      Membership; this field is never a substitute for it, and no
      identity/role data is ever copied onto a Resource row. */
  linkedMembershipId: string | null;
  /** Phase 30 (Identity Model Hardening & Staff Assignment Unification).
      -> StaffProfile.id. The canonical operational-assignment bridge for
      "which staff member does this resource represent" — added alongside
      `linkedMembershipId` rather than replacing it (Wix Data has no
      field-rename primitive, and `linkedMembershipId` is already live in
      several files; see ADR-034's migration-strategy section for the
      full reasoning). `linkedMembershipId` keeps its existing meaning,
      unused-in-logic exactly as before; new code resolving "which
      StaffProfile is this resource" reads this field instead, never
      `linkedMembershipId`, and never `Identity.id` directly (this
      codebase's hard layering invariant — types/staffProfile.ts's own
      header comment). Set only for `'staff'`/`'funeral_director'` rows,
      same as `linkedMembershipId`. */
  linkedStaffProfileId: string | null;
  capacity: number | null;
  /** True for resources Beacon does not itself operate (a cemetery, an
      outside florist) — trackable on an appointment for contact/notes
      purposes, but never conflict-checked, since Beacon has no visibility
      into a vendor's real availability. */
  isExternal: boolean;
  status: ResourceStatus;
  notes: string | null;
  /** Schema-evolution reserve, mirrors SignatureRequest.requestVersion
      exactly — starts at 1. */
  resourceVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type NewResourceInput = {
  locationId?: string;
  resourceType: ResourceType;
  name: string;
  linkedMembershipId?: string;
  linkedStaffProfileId?: string;
  capacity?: number;
  isExternal?: boolean;
  notes?: string;
};
