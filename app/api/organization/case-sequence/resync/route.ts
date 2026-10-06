import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageCaseNumbering } from '@/services/authorizationPolicyService';
import { getDataAdapterMode, type DataAdapterMode } from '@/lib/env';
import { getCaseSequenceState, initializeCaseSequence } from '@/lib/wixCaseNumberSequence';
import { formatCaseNumber, orgLocalYear } from '@/domain/cases/caseNumber';
import { getOrganization } from '@/services/organizationProvisioningService';
import { queryWixDataItems } from '@/lib/wixDataApi';
import type { WixCaseItem } from '@/lib/wixCaseMapper';
import { recordCaseSequenceInitialized } from '@/services/activityService';

/**
 * Case-number sequence resync (2026-10). Corrects a counter that has
 * fallen BEHIND the case numbers that actually exist, which happens
 * whenever a historical Jotform submission is imported: that path
 * preserves the number carried on the submission and deliberately never
 * calls `reserveNextCaseNumber` (see
 * domain/externalForms/historicalCaseNumber.ts), so the counter is left
 * untouched. Observed live for Manors — importing B2026-036 left
 * `nextSequence` at 36, which would have handed the next new case a
 * number that already existed.
 *
 * `app/api/cases/route.ts` now advances the counter itself after every
 * historical import (`advanceCaseSequencePast`), so this route is the
 * repair tool for sequences that are ALREADY behind — including the
 * current live Manors 2026 row — and the safety net if that best-effort
 * advance ever fails.
 *
 * Deliberately a separate route from the general-purpose
 * `../route.ts` (untouched by this file) and, like the one-time
 * `../manors-go-live-cutover/route.ts`, it accepts NO target value from
 * the client — the only reachable target is computed server-side as the
 * first number at or after the current `nextSequence` that no Case is
 * using. That preserves the general route's own safety property while
 * removing the need to type a raw sequence number into a form. Unlike the
 * go-live cutover this is NOT hardcoded to one organization, year or
 * transition: the same lag can recur after any future import, for any
 * organization.
 *
 * Can never move a counter backwards (the computed target is always >=
 * the current value, and `initializeCaseSequence` independently refuses
 * backwards moves), and never creates, edits or deletes a Case.
 */

/** Hard cap on the forward probe. A legitimate lag is a handful of
    imported numbers; anything beyond this is a symptom of something else
    (wrong organization, corrupted rows) and must fail loudly rather than
    walk the collection indefinitely or silently skip a large block of
    numbers. */
const MAX_PROBE = 50;

/** A pure existence check, matching the go-live cutover route's own
    helper: deliberately NOT going through `mapWixCaseItem`'s full
    validation, because a row that is malformed in some unrelated field
    must still count as existing, never be treated as a free number. */
async function caseNumberExists(organizationId: string, caseNumber: string): Promise<boolean> {
  const response = await queryWixDataItems<WixCaseItem>('cases', {
    filter: { organizationId, caseNumber },
    paging: { limit: 1 },
  });
  return response.dataItems.length > 0;
}

type ResyncPlan = {
  currentNextSequence: number | null;
  targetNextSequence: number | null;
  needsResync: boolean;
  /** The existing case numbers the counter is currently colliding with,
      in probe order — what makes the lag concrete in the UI. */
  collidingCaseNumbers: string[];
  reason: string | null;
};

/**
 * The single source of truth for what (if anything) this route would do —
 * called by GET to decide whether to offer the action, and again by POST
 * as the immediate pre-mutation revalidation. Never assumes the caller
 * already validated anything.
 */
async function buildResyncPlan(organizationId: string, year: number): Promise<ResyncPlan> {
  const state = await getCaseSequenceState(organizationId, year);
  const currentNextSequence = state?.nextSequence ?? null;

  if (currentNextSequence === null) {
    return {
      currentNextSequence: null,
      targetNextSequence: null,
      needsResync: false,
      collidingCaseNumbers: [],
      reason: `No ${year} case sequence exists yet for this organization, so there is nothing to resync.`,
    };
  }

  const collidingCaseNumbers: string[] = [];
  for (let offset = 0; offset <= MAX_PROBE; offset += 1) {
    const candidate = currentNextSequence + offset;
    if (!(await caseNumberExists(organizationId, formatCaseNumber(year, candidate)))) {
      return {
        currentNextSequence,
        targetNextSequence: candidate,
        needsResync: candidate > currentNextSequence,
        collidingCaseNumbers,
        reason:
          candidate > currentNextSequence
            ? null
            : `The ${year} sequence is already correct — ${formatCaseNumber(year, currentNextSequence)} is not in use.`,
      };
    }
    collidingCaseNumbers.push(formatCaseNumber(year, candidate));
  }

  // Fail closed rather than guess: never skip past an unexplained block
  // of more than MAX_PROBE consecutive existing numbers.
  return {
    currentNextSequence,
    targetNextSequence: null,
    needsResync: false,
    collidingCaseNumbers,
    reason: `More than ${MAX_PROBE} consecutive case numbers starting at ${formatCaseNumber(year, currentNextSequence)} already exist — refusing to resync automatically. Please review the case list.`,
  };
}

/** Resolves the year to operate on: an explicit `year` when given,
    otherwise the organization's own LOCAL calendar year — the same year
    `reserveNextCaseNumber` would use for a case created right now (see
    domain/cases/caseNumber.ts#orgLocalYear), never the server's/UTC's. */
async function resolveYear(organizationId: string, explicit: unknown): Promise<number | null> {
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    const year = Number(explicit);
    if (!Number.isInteger(year) || year < 2000 || year > 2999) return null;
    return year;
  }
  const organization = await getOrganization(organizationId, 'wix');
  return orgLocalYear(new Date().toISOString(), organization?.timezone);
}

/** GET — read-only. Reports whether the counter has fallen behind and
    what the correction would be. Never mutates. */
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
    return NextResponse.json({ error: 'Case sequence resync only applies when DATA_ADAPTER=wix.' }, { status: 400 });
  }

  const year = await resolveYear(resolvedOrganizationId, url.searchParams.get('year'));
  if (year === null) {
    return NextResponse.json({ error: 'year must be a 4-digit integer.' }, { status: 400 });
  }

  const plan = await buildResyncPlan(resolvedOrganizationId, year);
  return NextResponse.json({
    organizationId: resolvedOrganizationId,
    year,
    currentCaseNumber: plan.currentNextSequence !== null ? formatCaseNumber(year, plan.currentNextSequence) : null,
    targetCaseNumber: plan.targetNextSequence !== null ? formatCaseNumber(year, plan.targetNextSequence) : null,
    ...plan,
  });
}

/** POST — applies the correction. Authorization and the plan are always
    recomputed here from scratch, never trusting an earlier GET. */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; year?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const mode: DataAdapterMode = getDataAdapterMode();
  if (!(await canManageCaseNumbering({ identityId: authResult.context.userId, organizationId, roleKey: authResult.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  if (mode !== 'wix') {
    return NextResponse.json({ error: 'Case sequence resync only applies when DATA_ADAPTER=wix.' }, { status: 400 });
  }

  const year = await resolveYear(organizationId, b.year);
  if (year === null) {
    return NextResponse.json({ error: 'year must be a 4-digit integer.' }, { status: 400 });
  }

  // Immediate pre-mutation revalidation — never relies on an earlier GET,
  // which could be stale by the time the user confirms. Wix provides no
  // true compare-and-set here (documented, unchanged limitation — see
  // lib/wixCaseNumberSequence.ts); recomputing as close to the write as
  // possible and failing closed on any mismatch is the best available
  // mitigation, not a claim of full serializability.
  const plan = await buildResyncPlan(organizationId, year);
  if (!plan.needsResync || plan.targetNextSequence === null || plan.currentNextSequence === null) {
    return NextResponse.json(
      { error: plan.reason ?? 'Nothing to resync.', needsResync: false, currentNextSequence: plan.currentNextSequence },
      { status: 409 },
    );
  }

  // forceOverwrite is safe here specifically because the target was just
  // computed as strictly greater than the current value, satisfying
  // initializeCaseSequence's own forward-only guard.
  const result = await initializeCaseSequence(organizationId, year, plan.targetNextSequence, { forceOverwrite: true });

  try {
    await recordCaseSequenceInitialized(
      {
        organizationId,
        actorIdentityId: authResult.context.userId,
        actorMembershipId: null,
        actorRoleKey: authResult.context.role,
        correlationId: crypto.randomUUID(),
      },
      year,
      plan.currentNextSequence,
      result.nextSequence,
      mode,
    );
  } catch (auditError) {
    console.error(
      'Failed to record case.sequence.initialized activity event (case-sequence resync):',
      auditError instanceof Error ? auditError.message : auditError,
    );
  }

  return NextResponse.json({
    organizationId,
    year,
    nextSequence: result.nextSequence,
    nextCaseNumber: formatCaseNumber(year, result.nextSequence),
  });
}
