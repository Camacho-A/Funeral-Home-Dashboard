import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import {
  getCaseSequenceState,
  initializeCaseSequence,
  CaseSequenceAlreadyInitializedError,
} from '@/lib/wixCaseNumberSequence';
import { recordCaseSequenceInitialized } from '@/services/activityService';

/**
 * Manors launch-prep — P0 automatic case numbering. The administrator-
 * controlled initialization mechanism `lib/wixCaseNumberSequence.ts`'s own
 * comment describes: reads or sets a specific organization+year's starting
 * `nextSequence` in the `caseSequences` collection, so a transitional year
 * with pre-Solis manual history (Manor's real 2026 starting number) can
 * be seeded before the first case of that year is reserved. Every other
 * year still rolls over automatically via `reserveNextCaseNumber`'s own
 * bootstrap-at-1 path — this route is never required for normal annual
 * rollover, only for the one-time transitional seed.
 *
 * Gated by the existing `organization.manage` permission (administrator
 * only, among default roles) — no new permission key, matching every
 * other Manors-launch-prep permission decision. Wix-only: mock-mode
 * organizations have no real external case-number history to skip past,
 * so this route is a 400 outside `DATA_ADAPTER=wix`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  const yearParam = url.searchParams.get('year');
  if (!organizationId || !yearParam || !Number.isInteger(Number(yearParam))) {
    return NextResponse.json({ error: 'organizationId and a numeric year are required.' }, { status: 400 });
  }
  const year = Number(yearParam);

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: authorizedOrgId } = authResult.context;

  const mode = getDataAdapterMode();
  if (!(await canManageOrganization({ identityId: authResult.context.userId, organizationId: authorizedOrgId, roleKey: authResult.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  if (mode !== 'wix') {
    return NextResponse.json({ error: 'Case sequence initialization only applies when DATA_ADAPTER=wix.' }, { status: 400 });
  }

  const state = await getCaseSequenceState(authorizedOrgId, year);
  return NextResponse.json({ organizationId: authorizedOrgId, year, nextSequence: state?.nextSequence ?? null });
}

export async function POST(request: Request) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; year?: unknown; nextSequence?: unknown; forceOverwrite?: unknown };

  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (!Number.isInteger(b.year) || (b.year as number) < 2000 || (b.year as number) > 2999) {
    return NextResponse.json({ error: 'year must be a 4-digit integer.' }, { status: 400 });
  }
  if (!Number.isInteger(b.nextSequence) || (b.nextSequence as number) < 1) {
    return NextResponse.json({ error: 'nextSequence must be a positive integer — this is the NEXT number to be issued, not the last one used.' }, { status: 400 });
  }
  if (b.forceOverwrite !== undefined && typeof b.forceOverwrite !== 'boolean') {
    return NextResponse.json({ error: 'forceOverwrite must be a boolean.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const mode = getDataAdapterMode();
  if (!(await canManageOrganization({ identityId: authResult.context.userId, organizationId, roleKey: authResult.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  if (mode !== 'wix') {
    return NextResponse.json({ error: 'Case sequence initialization only applies when DATA_ADAPTER=wix.' }, { status: 400 });
  }

  try {
    // Audit trail (2026-09) — read the pre-change state ONLY for the audit
    // record (never used for any forward-only/CAS decision, which
    // initializeCaseSequence already owns entirely). Read before the
    // mutation so a failed/rejected call below never has a "previous
    // value" to falsely attach to a successful-event record.
    const previousState = await getCaseSequenceState(organizationId, b.year as number);

    const result = await initializeCaseSequence(organizationId, b.year as number, b.nextSequence as number, {
      forceOverwrite: b.forceOverwrite === true,
    });

    // Recorded only after the mutation above has actually succeeded — a
    // rejected/failed validation (caught below) never reaches this line,
    // so a failure can never be misrecorded as a successful cutover.
    try {
      await recordCaseSequenceInitialized(
        {
          organizationId,
          actorIdentityId: authResult.context.userId,
          actorMembershipId: null,
          actorRoleKey: authResult.context.role,
          correlationId: crypto.randomUUID(),
        },
        b.year as number,
        previousState?.nextSequence ?? null,
        result.nextSequence,
        mode,
      );
    } catch (auditError) {
      console.error('Failed to record case.sequence.initialized activity event:', auditError instanceof Error ? auditError.message : auditError);
    }

    return NextResponse.json({ organizationId, year: b.year, nextSequence: result.nextSequence });
  } catch (error) {
    if (error instanceof CaseSequenceAlreadyInitializedError) {
      return NextResponse.json(
        { error: error.message, currentNextSequence: error.currentNextSequence },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to initialize case sequence.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
