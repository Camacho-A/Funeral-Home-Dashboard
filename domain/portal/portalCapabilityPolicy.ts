import type { PortalAccess } from '../../types/portalAccess';
import type { PortalRelationshipType } from './portalRelationshipRegistry';

/**
 * Phase 29 (Family Portal & External Collaboration). Portal Permissions —
 * deliberately **not** RBAC. `domain/rbac/permissionCatalog.ts`'s whole
 * model (`role -> org-wide permission set`) assumes an active `Membership`;
 * a `PortalAccess` grant has neither a `Membership` nor an org-wide scope,
 * only a `relationshipType` and one specific case. This is a fully
 * separate, parallel dot-notation registry, structurally similar to
 * `PermissionKey`'s own shape but a distinct type/value space that must
 * never be confused with it — no file imports both `PermissionKey` and
 * `PortalCapabilityKey` for the same authorization decision.
 *
 * Every family-facing route checks exactly one of these via
 * `hasPortalCapability()` — never a raw `access.relationshipType === '...'`
 * comparison at a call site (the user's own explicit "never compare role
 * names" instruction, applied here to relationship types instead).
 */
export const PORTAL_CAPABILITY_KEYS = [
  'case.summary.read',
  'case.timeline.read',
  'document.read',
  'document.download',
  'signature.complete',
  'payment.read',
  'payment.pay',
  'appointment.read',
  'notification.read',
  'message.read',
  'message.send',
] as const;

export type PortalCapabilityKey = (typeof PORTAL_CAPABILITY_KEYS)[number];

export function isValidPortalCapabilityKey(value: unknown): value is PortalCapabilityKey {
  return typeof value === 'string' && (PORTAL_CAPABILITY_KEYS as readonly string[]).includes(value);
}

export const PORTAL_CAPABILITY_LABELS: Record<PortalCapabilityKey, string> = {
  'case.summary.read': 'View case summary',
  'case.timeline.read': 'View case timeline',
  'document.read': 'View documents',
  'document.download': 'Download documents',
  'signature.complete': 'Sign documents',
  'payment.read': 'View payments',
  'payment.pay': 'Make payments',
  'appointment.read': 'View appointments',
  'notification.read': 'View notifications',
  'message.read': 'Read messages',
  'message.send': 'Send messages',
};

const ALL_CAPABILITIES: readonly PortalCapabilityKey[] = PORTAL_CAPABILITY_KEYS;
const ALL_EXCEPT_PAY: readonly PortalCapabilityKey[] = PORTAL_CAPABILITY_KEYS.filter((key) => key !== 'payment.pay');
const NONE: readonly PortalCapabilityKey[] = [];

/** The default capability grant per relationship type. A registry, not a
    per-call decision — see this file's own header comment. Reserved
    relationship types (see `portalRelationshipRegistry.ts`'s own
    `implemented: false` entries) grant zero capabilities until a future
    phase both wires a real invitation flow for them and decides what
    they may do. */
const RELATIONSHIP_CAPABILITIES: Record<PortalRelationshipType, readonly PortalCapabilityKey[]> = {
  primary_next_of_kin: ALL_CAPABILITIES,
  executor: ALL_CAPABILITIES,
  secondary_family_member: ALL_EXCEPT_PAY,
  authorized_representative: ALL_EXCEPT_PAY,
  attorney: NONE,
  insurance_adjuster: NONE,
  veteran_representative: NONE,
  church_representative: NONE,
  funeral_home_partner: NONE,
};

/** The one function every family-facing route calls to make an
    authorization decision — fails closed for any status other than
    `'active'`, regardless of what the relationship type would otherwise
    grant. */
export function hasPortalCapability(access: PortalAccess, capability: PortalCapabilityKey): boolean {
  if (access.status !== 'active') return false;
  return RELATIONSHIP_CAPABILITIES[access.relationshipType].includes(capability);
}
