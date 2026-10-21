import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canEditCase } from '@/services/authorizationPolicyService';
import { recordSlaDelay, recordSlaEvent, resolveSlaDelay, SlaActionError } from '@/services/slaService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * SLA tracking (2026-10). Staff record what SOLIS cannot see for itself —
 * when the doctor's attestation arrived, when the state approved, when the
 * crematory received the decedent — and delays against a milestone. Same
 * permission as editing the case; archived cases refuse every action.
 *
 *   { action: 'record_event', event, at }
 *   { action: 'record_delay', milestone, reason, responsibleParty?, notes?, expectedResolutionDate? }
 *   { action: 'resolve_delay', delayId }
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to update this case.' }, { status: 403 });
  }

  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  const text = (value: unknown) => (typeof value === 'string' ? value : null);

  try {
    let updated;
    switch (b.action) {
      case 'record_event':
        if (typeof b.event !== 'string' || typeof b.at !== 'string') return NextResponse.json({ error: 'event and at are required.' }, { status: 400 });
        updated = await recordSlaEvent(ctx, caseId, b.event, b.at, dataAdapterMode);
        break;
      case 'record_delay':
        if (typeof b.milestone !== 'string' || typeof b.reason !== 'string') return NextResponse.json({ error: 'milestone and reason are required.' }, { status: 400 });
        updated = await recordSlaDelay(
          ctx,
          caseId,
          { milestone: b.milestone, reason: b.reason, responsibleParty: text(b.responsibleParty), notes: text(b.notes), expectedResolutionDate: text(b.expectedResolutionDate) },
          dataAdapterMode,
        );
        break;
      case 'resolve_delay':
        if (typeof b.delayId !== 'string') return NextResponse.json({ error: 'delayId is required.' }, { status: 400 });
        updated = await resolveSlaDelay(ctx, caseId, b.delayId, dataAdapterMode);
        break;
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ case: updated, changed: updated !== null });
  } catch (error) {
    if (error instanceof SlaActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('SLA action failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The SLA update could not be saved. Please try again.' }, { status: 500 });
  }
}
