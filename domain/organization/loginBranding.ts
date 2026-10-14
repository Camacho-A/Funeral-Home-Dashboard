/**
 * Which organization's logo the sign-in screen shows (2026-10).
 *
 * The login screen is the one surface with no signed-in user, so none of
 * the usual tenant resolution applies — there is no session, no
 * membership, and no `OrganizationContext` to read. The organization has
 * to be derived from the deployment itself.
 *
 * Two rules, in order:
 *
 * 1. `LOGIN_ORGANIZATION_ID`, when the deployment sets it. Explicit, and
 *    the answer once a second organization exists — each one gets its own
 *    domain and its own value.
 * 2. Otherwise, the single active organization, if there is exactly one.
 *    A single-tenant deployment needs no configuration to show its own
 *    logo, which is the situation today.
 *
 * When neither rule produces an answer — several organizations and
 * nothing configured — the result is `null` and the screen shows the
 * SOLIS lockup alone, exactly as before. That is deliberate: guessing
 * between tenants would show one funeral home's branding to another's
 * staff, and showing nothing is the honest outcome of an ambiguous
 * deployment.
 *
 * Note that the organization is NEVER taken from the request (no query
 * parameter, no client-supplied id). An unauthenticated page that
 * rendered any organization's branding on demand would let anyone
 * enumerate tenants; a value fixed by the deployment cannot.
 */
export function resolveLoginOrganizationId(params: {
  /** `LOGIN_ORGANIZATION_ID`, or null when the deployment doesn't set it. */
  configuredOrganizationId: string | null | undefined;
  /** Ids of every organization currently active in this deployment. */
  activeOrganizationIds: readonly string[];
}): string | null {
  const configured = (params.configuredOrganizationId ?? '').trim();
  if (configured !== '') return configured;

  return params.activeOrganizationIds.length === 1 ? params.activeOrganizationIds[0] : null;
}
