import type { Organization, OrganizationContext } from '../types/organization';

/**
 * Phase 15A (Wix Organization Read Integration). Unlike every other
 * `services/*` module, this one never branches on `DATA_ADAPTER` itself —
 * it always calls the `/api/organizations/[organizationId]` Route
 * Handler. That's deliberate: this service is called from a Client
 * Component hook (useOrganizationRecord), and `DATA_ADAPTER` (unlike a
 * `NEXT_PUBLIC_*` variable) is never visible in the browser bundle, so a
 * client-side branch on it would silently always take the mock path
 * regardless of the real server configuration. The Route Handler is the
 * one place that reads the real, server-side `DATA_ADAPTER` and decides
 * whether to read the mock fixture or query Wix — the same pattern
 * app/api/wix-health/route.ts already established in Phase 12. Nothing
 * about the Wix response shape leaks past that boundary: this function's
 * return type is the same `Organization` domain type mock mode always
 * returned.
 */
export async function get(context: OrganizationContext): Promise<Organization | null> {
  const response = await fetch(`/api/organizations/${encodeURIComponent(context.organizationId)}`);

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Failed to load organization.');
  }

  const body = (await response.json()) as { organization: Organization | null };
  return body.organization;
}

export const organizationsService = { get };
