import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getDataAdapterMode } from '@/lib/env';
import { canEditCase } from '@/services/authorizationPolicyService';
import { approveCremationRelease, CremationReleaseError } from '@/services/cremationReleaseService';

/**
 * Gus Phase 5K (2026-11). POST { organizationId, confirm: true } → releases
 * the remains for cremation after the service (case.update). Who approves,
 * when, and every requirement are decided on the server from the session,
 * the case and the approver's own credentials — the body carries nothing
 * else. NOT ACTIVE: refused with 423 while RELEASE_FOR_CREMATION_AVAILABLE
 * (or preparation saving on this site) is off. Records only; sends nothing,
 * and Send to Crematory is unchanged.
 */
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
  const auth = await requireAuthorizedOrganization(body.organizationId);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();
  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to change this case.' }, { status: 403 });
  }
  try {
    const { release, evaluation } = await approveCremationRelease({ organizationId, userId, role }, caseId, mode);
    return NextResponse.json({ release, evaluation });
  } catch (error) {
    if (error instanceof CremationReleaseError) {
      return NextResponse.json({ error: error.message, ...(error.evaluation ? { evaluation: error.evaluation } : {}) }, { status: error.status });
    }
    console.error('Release for cremation failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not release. Nothing was released — please try again.' }, { status: 500 });
  }
}
