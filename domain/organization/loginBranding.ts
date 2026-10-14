/**
 * Which organization's branding the sign-in screen shows (2026-10).
 *
 * The login screen is the one surface with no signed-in user, so none of
 * the usual tenant resolution applies — there is no session, no
 * membership, and no `OrganizationContext` to read. It has to come from
 * the deployment itself, and only from the deployment.
 *
 * Two rules, in order:
 *
 * 1. The request's own hostname, matched against the deployment's
 *    configured host map (`LOGIN_ORGANIZATION_HOSTS`). This is the
 *    multi-organization answer: each funeral home gets its own domain,
 *    and one deployment can serve several.
 * 2. `LOGIN_ORGANIZATION_ID`, for a deployment that serves exactly one
 *    organization on any hostname.
 *
 * Anything else — an unmapped hostname, no configuration at all — returns
 * `null`, and the screen shows SOLIS branding alone. There is deliberately
 * NO "if there's only one organization, use it" inference: a generic SOLIS
 * login must never default into some tenant's branding just because that
 * tenant happens to be the only one in the database today.
 *
 * **The organization is never taken from user-controlled input** — no
 * query parameter, no client-supplied id, no request body. Only a
 * hostname the deployment itself has been configured to recognise. The
 * worst an attacker can do by forging a Host header is see a logo and
 * name that the mapped organization's own public website already shows;
 * nothing private is reachable, because only branding is ever read here
 * and only for an explicitly configured host.
 */

/** Normalises a hostname for comparison: case, port, and the trailing dot
    of a fully-qualified name are all noise here. */
function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase();
  // An IPv6 literal is bracketed ("[::1]:3000"); strip the port only
  // after the closing bracket so the address itself survives.
  const closingBracket = value.lastIndexOf(']');
  const colon = value.indexOf(':', closingBracket + 1);
  if (colon !== -1) value = value.slice(0, colon);
  if (value.endsWith('.')) value = value.slice(0, -1);
  return value;
}

/**
 * Parses `LOGIN_ORGANIZATION_HOSTS` — `host=organizationId`, comma or
 * newline separated:
 *
 *     solis.manorscremation.com=managed-cremations,
 *     beacon.manorscremation.com=managed-cremations
 *
 * Malformed entries are skipped rather than throwing. A typo in one
 * mapping must cost that one hostname its logo, never the whole login
 * screen for every organization on the deployment.
 */
export function parseLoginOrganizationHosts(raw: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of (raw ?? '').split(/[,\n]/)) {
    const separator = entry.indexOf('=');
    if (separator === -1) continue;
    const host = normalizeHost(entry.slice(0, separator));
    const organizationId = entry.slice(separator + 1).trim();
    if (host === '' || organizationId === '') continue;
    map.set(host, organizationId);
  }
  return map;
}

export function resolveLoginOrganizationId(params: {
  /** The request's `Host` header, or null when it can't be read. */
  host: string | null | undefined;
  /** The parsed `LOGIN_ORGANIZATION_HOSTS` map. */
  hostOrganizationIds: ReadonlyMap<string, string>;
  /** `LOGIN_ORGANIZATION_ID`, or null when the deployment doesn't set it. */
  configuredOrganizationId: string | null | undefined;
}): string | null {
  const host = params.host ? normalizeHost(params.host) : '';
  if (host !== '') {
    const mapped = params.hostOrganizationIds.get(host);
    if (mapped) return mapped;
  }

  // Only reached when the hostname is unmapped — so a deployment that
  // sets both gets its host map honoured first, and the single-tenant
  // value as the answer for every other hostname it answers on.
  const configured = (params.configuredOrganizationId ?? '').trim();
  return configured === '' ? null : configured;
}
