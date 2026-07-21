/**
 * Tenant-scoping context, per docs/adr/ADR-002-multi-tenant-architecture.md.
 * Every service call takes this as its first argument; it is only ever
 * obtained via useOrganization() (see hooks/useOrganization.ts), never
 * hardcoded.
 */
export type OrganizationContext = {
  organizationId: string;
};
