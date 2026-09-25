import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageCaseNumbering } from '@/services/authorizationPolicyService';
import { getDataAdapterMode, type DataAdapterMode } from '@/lib/env';
import { getCaseSequenceState, initializeCaseSequence } from '@/lib/wixCaseNumberSequence';
import { formatCaseNumber } from '@/domain/cases/caseNumber';
import { queryWixDataItems } from '@/lib/wixDataApi';
import type { WixCaseItem } from '@/lib/wixCaseMapper';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { recordCaseSequenceInitialized } from '@/services/activityService';

/**
 * Manors go-live case-number cutover (2026-09) — a narrowly-scoped,
 * ONE-TIME administrative action, NOT a general-purpose sequence editor.
 * Hardcoded to exactly one organization/year/transition: B2026-034 and
 * B2026-035 are real, pre-existing Manors case numbers already recorded
 * in Jotform but never created in SOLIS (to be imported separately,
 * later, preserving those exact numbers — see
 * domain/externalForms/historicalCaseNumber.ts). This action establishes
 * B2026-036 as the next NORMAL SOLIS-allocated case number, without
 * touching either historical number, creating any Case, or calling
 * `reserveNextCaseNumber`.
 *
 * Deliberately a SEPARATE route from the existing general-purpose
 * `app/api/organization/case-sequence/route.ts` (untouched by this
 * file) rather than an extension of it — the extra checks here
 * (expected-current-value, duplicate-case existence for three SPECIFIC
 * case numbers) are meaningful only for this one Manors migration, and
 * would be actively wrong if layered onto that generic endpoint for an
 * unrelated organization/year. This route reuses that mechanism's own
 * underlying functions directly (`initializeCaseSequence`,
 * `recordCaseSequenceInitialized`) — zero duplicated mutation or audit
 * logic, just a narrower, additional set of guards in front of them.
 *
 * Once `nextSequence` reaches TARGET_NEXT_SEQUENCE, `checkEligibility`
 * permanently reports `eligible: false` (current value no longer equals
 * EXPECTED_CURRENT_NEXT_SEQUENCE) — this action cannot run twice, and
 * there is no code path here that accepts an arbitrary target value from
 * the client.
 */
const MANORS_ORGANIZATION_ID = 'managed-cremations';
const TARGET_YEAR = 2026;
const EXPECTED_CURRENT_NEXT_SEQUENCE = 34;
const TARGET_NEXT_SEQUENCE = 36;
const HISTORICAL_CASE_NUMBERS = [formatCaseNumber(TARGET_YEAR, 34), formatCaseNumber(TARGET_YEAR, 35)];
const FIRST_NORMAL_CASE_NUMBER = formatCaseNumber(TARGET_YEAR, TARGET_NEXT_SEQUENCE);

/** A pure existence check — deliberately NOT going through
    `mapWixCaseItem`'s full Case validation (unlike the similar helpers in
    historical-jotform-import/route.ts and the [formConfigId]/
    import-submission route's `loadCase`, which need the fully-parsed
    Case). This check only ever needs to answer "does a row with this
    caseNumber already exist" for collision prevention — a row that
    happens to be malformed in some unrelated field must still count as
    existing, never be silently treated as absent. */
async function findCaseIdByCaseNumber(organizationId: string, caseNumber: string, dataAdapterMode: DataAdapterMode): Promise<string | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.organizationId === organizationId && c.caseNumber === caseNumber)?.id ?? null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', { filter: { organizationId, caseNumber }, paging: { limit: 1 } });
  return response.dataItems[0]?.id ?? null;
}

type EligibilityResult = {
  eligible: boolean;
  reason: string | null;
  currentNextSequence: number | null;
};

/**
 * The single source of truth for whether this action may run — called
 * both by GET (to decide whether to show the control at all) and by POST
 * (as the immediate pre-mutation revalidation required by this
 * checkpoint). Never assumes the caller already validated anything.
 */
async function checkEligibility(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<EligibilityResult> {
  if (organizationId !== MANORS_ORGANIZATION_ID) {
    return { eligible: false, reason: 'This action is only available for the Manors organization.', currentNextSequence: null };
  }

  const state = await getCaseSequenceState(organizationId, TARGET_YEAR);
  const currentNextSequence = state?.nextSequence ?? null;

  if (currentNextSequence !== EXPECTED_CURRENT_NEXT_SEQUENCE) {
    return {
      eligible: false,
      reason:
        currentNextSequence === null
          ? `No ${TARGET_YEAR} case sequence exists yet for this organization.`
          : `The ${TARGET_YEAR} sequence is currently ${currentNextSequence}, not the expected ${EXPECTED_CURRENT_NEXT_SEQUENCE} — this action has either already run or the sequence changed.`,
      currentNextSequence,
    };
  }

  for (const caseNumber of [...HISTORICAL_CASE_NUMBERS, FIRST_NORMAL_CASE_NUMBER]) {
    const existingId = await findCaseIdByCaseNumber(organizationId, caseNumber, dataAdapterMode);
    if (existingId) {
      return { eligible: false, reason: `A Case already exists with number ${caseNumber} — this action cannot proceed safely.`, currentNextSequence };
    }
  }

  return { eligible: true, reason: null, currentNextSequence };
}

/** GET — read-only eligibility + current-state check, used to decide
    whether to show the control at all and what to display. Never mutates. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId } = authResult.context;

  const mode = getDataAdapterMode();
  if (!(await canManageCaseNumbering({ identityId: authResult.context.userId, organizationId: resolvedOrganizationId, roleKey: authResult.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  if (mode !== 'wix') {
    return NextResponse.json({ error: 'This action only applies when DATA_ADAPTER=wix.' }, { status: 400 });
  }

  const result = await checkEligibility(resolvedOrganizationId, mode);
  return NextResponse.json({
    organizationId: resolvedOrganizationId,
    year: TARGET_YEAR,
    targetNextSequence: TARGET_NEXT_SEQUENCE,
    historicalCaseNumbers: HISTORICAL_CASE_NUMBERS,
    firstNormalCaseNumber: FIRST_NORMAL_CASE_NUMBER,
    ...result,
  });
}

/** POST — executes the cutover. Authorization + eligibility are always
    re-verified here from scratch, never trusting an earlier GET. */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const mode = getDataAdapterMode();
  if (!(await canManageCaseNumbering({ identityId: authResult.context.userId, organizationId, roleKey: authResult.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  if (mode !== 'wix') {
    return NextResponse.json({ error: 'This action only applies when DATA_ADAPTER=wix.' }, { status: 400 });
  }

  // Immediate pre-mutation revalidation — never relies on an earlier
  // GET, which could be stale by the time the user confirms. Wix
  // provides no true compare-and-set here (documented, unchanged
  // limitation — see lib/wixCaseNumberSequence.ts); re-checking as close
  // to the write as possible and failing closed on any mismatch is the
  // best available mitigation, not a claim of full serializability.
  const revalidation = await checkEligibility(organizationId, mode);
  if (!revalidation.eligible || revalidation.currentNextSequence === null) {
    return NextResponse.json(
      { error: revalidation.reason, eligible: false, currentNextSequence: revalidation.currentNextSequence },
      { status: 409 },
    );
  }

  // Reuses the exact same mutation function the general-purpose route
  // calls — no duplicated Wix-write logic. forceOverwrite is safe here
  // specifically because checkEligibility just confirmed the current
  // value equals EXPECTED_CURRENT_NEXT_SEQUENCE, which is less than
  // TARGET_NEXT_SEQUENCE, satisfying initializeCaseSequence's own
  // forward-only guard.
  const result = await initializeCaseSequence(organizationId, TARGET_YEAR, TARGET_NEXT_SEQUENCE, { forceOverwrite: true });

  try {
    await recordCaseSequenceInitialized(
      {
        organizationId,
        actorIdentityId: authResult.context.userId,
        actorMembershipId: null,
        actorRoleKey: authResult.context.role,
        correlationId: crypto.randomUUID(),
      },
      TARGET_YEAR,
      revalidation.currentNextSequence,
      result.nextSequence,
      mode,
    );
  } catch (auditError) {
    console.error(
      'Failed to record case.sequence.initialized activity event (Manors go-live cutover):',
      auditError instanceof Error ? auditError.message : auditError,
    );
  }

  return NextResponse.json({ organizationId, year: TARGET_YEAR, nextSequence: result.nextSequence });
}
