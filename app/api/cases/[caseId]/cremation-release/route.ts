import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getDataAdapterMode } from '@/lib/env';
import { canEditCase } from '@/services/authorizationPolicyService';
import { CremationReleaseError, performReleaseAction, type ReleaseAction } from '@/services/cremationReleaseService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';

/**
 * Gus Phase 5K / release holds (2026-11). POST { organizationId, confirm:
 * true, action?, reason? } (case.update):
 *   action 'release' (default) — release, or request release when the
 *          caller is not a licensed, authorized director;
 *   'sign_off'    — a licensed director signs off a pending request;
 *   'hold'        — place the release on hold (reason required);
 *   'reauthorize' — lift a hold, or request that it be lifted.
 * Who, when, and every requirement are decided on the server from the
 * session, the case and the caller's own credentials. NOT ACTIVE: refused
 * with 423 while RELEASE_FOR_CREMATION_AVAILABLE (or preparation saving on
 * this site) is off. Records only; sends nothing, recalls nothing.
 */
const ACTIONS: readonly ReleaseAction[] = ['release', 'sign_off', 'hold', 'reauthorize'];
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { caseId } = await params;
  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (body.confirm !== true) return NextResponse.json({ error: 'Confirm the release.' }, { status: 400 });
  const action = (body.action ?? 'release') as ReleaseAction;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > 300)) {
    return NextResponse.json({ error: 'reason must be text of up to 300 characters.' }, { status: 400 });
  }
  const auth = await requireAuthorizedOrganization(body.organizationId);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();
  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to change this case.' }, { status: 403 });
  }
  try {
    const actorName = (await resolveStaffProfileForCaller({ organizationId, userId, role }, mode))?.displayName ?? null;
    const { event, status, evaluation } = await performReleaseAction({ organizationId, userId, role }, caseId, mode, { action, reason: (body.reason as string | null | undefined) ?? null, actorName });
    return NextResponse.json({ event, status, evaluation });
  } catch (error) {
    if (error instanceof CremationReleaseError) {
      return NextResponse.json({ error: error.message, ...(error.evaluation ? { evaluation: error.evaluation } : {}) }, { status: error.status });
    }
    console.error('Release for cremation failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not release. Nothing was released — please try again.' }, { status: 500 });
  }
}
