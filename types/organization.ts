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
 * Phase 20 (Organization Onboarding & Tenant Provisioning). An
 * organization's lifecycle state — richer than the pre-existing `isActive`
 * boolean, which remains unchanged and is still what
 * `lib/auth/authorize.ts`'s `resolveAuthorizationContext` reads (an
 * organization is a valid membership target only while `isActive`, exactly
 * as before this phase). `status` and `isActive` are kept in sync by
 * `services/organizationProvisioningService.ts` (`isActive = status ===
 * 'active'`) rather than one being derived from the other at read time, so
 * every pre-Phase-20 caller reading only `isActive` keeps working
 * unchanged — see this type's own field comments below.
 */
export type OrganizationStatus = 'draft' | 'onboarding' | 'active' | 'suspended' | 'archived';

/**
 * Phase 13 (Authentication & Organizations). A real organization entity —
 * previously only ever referenced by its bare id. Membership/role
 * resolution needs more than an id: a display name, and whether the
 * organization itself is active (a suspended organization should reject
 * access even for a member with an otherwise-active membership).
 *
 * Phase 20 additions (all optional — every pre-Phase-20 `Organization`
 * literal, fixture, and `lib/wixOrganizationMapper.ts` read of a
 * not-yet-migrated live Wix row remains a fully valid value of this type
 * with no forced migration; see `docs/adr/ADR-024-organization-onboarding-tenant-provisioning.md`).
 * `name` continues to serve as the organization's *display* name — Phase
 * 20's separate onboarding-form "legal name" field is `legalName`, since a
 * legal entity name (e.g. "Manor's Cremation Services, LLC") can
 * legitimately differ from the shorter display name already used
 * everywhere else in the app.
 */
export type Organization = {
  id: string;
  name: string;
  isActive: boolean;
  legalName?: string;
  /** URL-safe, globally unique, immutable once `status` reaches `active`
      (see domain/onboarding/slug.ts) — e.g. `manors-cremation`. */
  slug?: string;
  status?: OrganizationStatus;
  /** IANA timezone name, e.g. `America/New_York`. */
  timezone?: string;
  /** ISO 4217 currency code, lowercase, e.g. `usd` — matches
      `PaymentRecord.currency`'s own convention. */
  defaultCurrency?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  website?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
