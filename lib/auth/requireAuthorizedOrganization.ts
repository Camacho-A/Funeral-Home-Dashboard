import { NextResponse } from 'next/server';
import type { AuthorizationContext } from '../../types/authorization';
import { getSession } from './session';
import { resolveAuthorizationContext } from './authorize';

/**
 * Phase 15X (Multi-Tenant Authorization Hardening). The one function every
 * Wix-backed Route Handler must call before using a client-supplied
 * organizationId for anything. See docs/adr/ADR-015-multi-tenant-authorization-hardening.md
 * and docs/ROADMAP.md's "Planned: Multi-Tenant Authorization Hardening"
 * entry, which this closes.
 *
 * This is deliberately a thin HTTP-facing wrapper, not a second
 * authorization implementation: the actual decision (does this session
 * have an active membership in this organization?) is made entirely by
 * lib/auth/authorize.ts's resolveAuthorizationContext — already used by
 * app/(portal)/layout.tsx to gate page rendering, and already fully tested
 * (authorize.test.ts) — this function only adds the two things a Route
 * Handler needs that a Server Component doesn't: reading the session
 * itself (a Route Handler has no session already resolved for it the way
 * a layout does) and turning a denial into a standardized NextResponse.
 *
 * `requestedOrganizationId` is treated exactly as untrusted input,
 * regardless of whether it arrived as a path param or a query param —
 * the caller's own session-derived memberships are the only thing that
 * can ever grant access to it. On success, callers must use
 * `context.organizationId` (never the raw requested value) for whatever
 * query follows — see each Route Handler's own comment.
 *
 * Every denial reason resolveAuthorizationContext can produce
 * (no_active_membership, organization_mismatch, selection_required) is
 * deliberately collapsed into the same generic 403 response here: a
 * caller probing which of those applies would be learning about another
 * organization's existence or this user's own membership shape, which
 * "do not leak organization existence or membership information" forbids.
 * No session at all is the only case distinguished (401 vs. 403) — that
 * distinction is standard HTTP semantics, not a membership-shaped leak.
 */
export type RouteAuthorizationResult =
  | { authorized: true; context: AuthorizationContext }
  | { authorized: false; response: NextResponse };

const UNAUTHENTICATED_RESPONSE = () =>
  NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

const FORBIDDEN_RESPONSE = () =>
  NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });

export async function requireAuthorizedOrganization(
  requestedOrganizationId: string,
): Promise<RouteAuthorizationResult> {
  const session = await getSession();
  if (!session) {
    return { authorized: false, response: UNAUTHENTICATED_RESPONSE() };
  }

  const result = resolveAuthorizationContext(session, requestedOrganizationId);
  if (!result.granted) {
    return { authorized: false, response: FORBIDDEN_RESPONSE() };
  }

  return { authorized: true, context: result.context };
}
