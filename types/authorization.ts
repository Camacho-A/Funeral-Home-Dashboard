/**
 * The server-resolved, trusted authorization result for one request — the
 * only organizationId any protected operation should ever act on. Never
 * constructed directly from a browser-supplied organizationId; always
 * produced by lib/auth/authorize.ts's resolveAuthorizationContext (for a
 * mock/wix-mode session) or
 * lib/auth/resolveMembershipAuthorizationContext.ts (for an identity-mode
 * session), each of which validates the session and the user's membership
 * (and the organization itself) are all active before this type can exist
 * at all.
 *
 * Structurally compatible with the existing OrganizationContext (it has at
 * least `organizationId: string`), so it can be passed anywhere a service
 * already expects one — see hooks/useOrganization.tsx, which now sources
 * its value from this instead of a hardcoded constant, without any
 * existing service call site needing to change.
 *
 * Phase 22 (Role-Based Access Control): `role` widened from the closed
 * `OrganizationRole` union to a plain role key, matching
 * `types/membership.ts`'s identical widening of `Membership.role` — the
 * same field now has to carry either model's role value (the legacy
 * five-value vocabulary, a Phase 22 default role key, or a custom role
 * key), and permission resolution (`services/permissionService.ts`) treats
 * it as an opaque key to resolve, never a fixed enum.
 */
export type AuthorizationContext = {
  userId: string;
  organizationId: string;
  role: string;
};
