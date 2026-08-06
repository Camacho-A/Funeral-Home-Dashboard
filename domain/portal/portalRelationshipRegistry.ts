/**
 * Phase 29 (Family Portal & External Collaboration). The stable,
 * machine-readable relationship taxonomy every `PortalAccess.relationshipType`
 * picks exactly one entry from — mirrors `domain/scheduling/appointmentTypeRegistry.ts`'s
 * exact convention: a code registry, not a Wix collection, so "design for
 * future expansion" is satisfied by adding a registry entry, never a
 * schema change.
 *
 * `implemented: false` entries are real, valid `PortalRelationshipType`
 * values today — a `PortalAccess` row could theoretically be created with
 * one — but `domain/portal/portalCapabilityPolicy.ts`'s own capability
 * table grants them zero capabilities, so in practice they're inert until
 * a future phase both wires a real invitation flow for them and decides
 * what they may do.
 */
export type PortalRelationshipType =
  | 'primary_next_of_kin'
  | 'secondary_family_member'
  | 'authorized_representative'
  | 'executor'
  // Reserved — no capability grants yet (see portalCapabilityPolicy.ts).
  | 'attorney'
  | 'insurance_adjuster'
  | 'veteran_representative'
  | 'church_representative'
  | 'funeral_home_partner';

export const PORTAL_RELATIONSHIP_TYPES: Record<PortalRelationshipType, { displayName: string; implemented: boolean }> = {
  primary_next_of_kin: { displayName: 'Primary Next of Kin', implemented: true },
  secondary_family_member: { displayName: 'Secondary Family Member', implemented: true },
  authorized_representative: { displayName: 'Authorized Representative', implemented: true },
  executor: { displayName: 'Executor', implemented: true },
  attorney: { displayName: 'Attorney', implemented: false },
  insurance_adjuster: { displayName: 'Insurance Adjuster', implemented: false },
  veteran_representative: { displayName: 'Veteran Representative', implemented: false },
  church_representative: { displayName: 'Church Representative', implemented: false },
  funeral_home_partner: { displayName: 'Funeral Home Partner', implemented: false },
};

const PORTAL_RELATIONSHIP_TYPE_KEYS = Object.keys(PORTAL_RELATIONSHIP_TYPES) as PortalRelationshipType[];

export function isValidPortalRelationshipType(value: unknown): value is PortalRelationshipType {
  return typeof value === 'string' && (PORTAL_RELATIONSHIP_TYPE_KEYS as string[]).includes(value);
}
