import type { OrganizationRole } from './organization';

/**
 * The server-resolved, trusted authorization result for one request — the
 * only organizationId any protected operation should ever act on. Never
 * constructed directly from a browser-supplied organizationId; always
 * produced by lib/auth/authorize.ts's resolveAuthorizationContext, which
 * validates the session and the user's membership (and the organization
 * itself) are all active before this type can exist at all.
 *
 * Structurally compatible with the existing OrganizationContext (it has at
 * least `organizationId: string`), so it can be passed anywhere a service
 * already expects one — see hooks/useOrganization.tsx, which now sources
 * its value from this instead of a hardcoded constant, without any
 * existing service call site needing to change.
 */
export type AuthorizationContext = {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
};
