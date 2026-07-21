/**
 * Tenant-scoping context, per docs/adr/ADR-002-multi-tenant-architecture.md.
 * Every service call takes this as its first argument; it is only ever
 * obtained via useOrganization() (see hooks/useOrganization.ts), never
 * hardcoded.
 *
 * Phase 13: useOrganization() now sources this from a server-resolved
 * AuthorizationContext (see types/authorization.ts) instead of a bare
 * hardcoded constant — this type's own shape is unchanged so no existing
 * service call site needed to change.
 */
export type OrganizationContext = {
  organizationId: string;
};

/**
 * Phase 13 (Authentication & Organizations). A real organization entity —
 * previously only ever referenced by its bare id. Membership/role
 * resolution needs more than an id: a display name, and whether the
 * organization itself is active (a suspended organization should reject
 * access even for a member with an otherwise-active membership).
 */
export type Organization = {
  id: string;
  name: string;
  isActive: boolean;
};

/**
 * Deliberately small — five roles, no granular permission matrix. See
 * docs/AUTHENTICATION.md for why this phase stops here rather than
 * building out per-action permissions.
 */
export type OrganizationRole = 'owner' | 'administrator' | 'caseManager' | 'staff' | 'readOnly';

/**
 * One user's relationship to one organization. `isActive` is checked
 * independently of the user's own session validity and the organization's
 * own `isActive` — all three must hold for access to be granted (see
 * lib/auth/authorize.ts's resolveAuthorizationContext).
 */
export type OrganizationMembership = {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  isActive: boolean;
};
