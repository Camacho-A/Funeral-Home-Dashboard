import { NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { setSessionOrganization } from '@/services/sessionService';

/**
 * Phase 21 (Identity, Authentication & Session Management). "Users with
 * multiple memberships switch without logging out; current org must
 * always be server-derived; never trust organizationId from browser
 * state; switching creates a new org-scoped session context." The
 * requested organizationId is untrusted input exactly like every other
 * route's client-supplied id — resolveMembershipAuthorizationContext
 * independently confirms an active Membership exists before this route
 * ever persists the switch to the session registry row.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identitySession, dataAdapterMode } = access;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId } = parsed.body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const result = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!result.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }

  await setSessionOrganization(identitySession.id, result.context.organizationId, dataAdapterMode);
  return NextResponse.json({ ok: true, organizationId: result.context.organizationId, role: result.context.role });
}
