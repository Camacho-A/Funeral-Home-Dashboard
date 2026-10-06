import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems, queryAllWixDataItems, insertWixDataItem } from '@/lib/wixDataApi';
import { mapWixCaseItem, buildWixCaseData, isValidNextOfKinRelationship, describeMapWixCaseItemFailure, type WixCaseItem } from '@/lib/wixCaseMapper';
import {
  CASE_LIST_SORT,
  buildCaseListWixFilter,
  buildCaseSearchWixFilter,
  clampCaseListPageSize,
  compareCasesForListSort,
  encodeCaseCursor,
  matchesCaseSearch,
  validateCaseCursor,
} from '@/lib/casePagination';
import { STAGES, rawStagesForStageLabel } from '@/domain/cases/stages';
import { fetchWixWorkflowTemplates } from '@/lib/wixWorkflowTemplateMapper';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '@/domain/workflow/snapshot';
import { reserveNextCaseNumber, advanceCaseSequencePast } from '@/lib/wixCaseNumberSequence';
import { orgLocalYear, parseCaseNumber } from '@/domain/cases/caseNumber';
import { verifyHistoricalCaseNumberAuthorization } from '@/lib/auth/historicalCaseNumberAuthorization';
import { findForbiddenPaymentFields } from '@/lib/paymentFieldGuard';
import { isValidEmail, getDateOfBirthFutureError, getDateOfDeathFutureError, resolveOrgLocalToday } from '@/utils/inputMask';
import { isValidReturnMethod } from '@/domain/cases/returnMethod';
import type { ReturnMethod } from '@/types/case';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { matchesSearch } from '@/services/casesService';
import { getOrganization } from '@/services/organizationProvisioningService';
import { resolveStaffProfileForCaller, assertAssignableStaffProfile, StaffAssignmentError } from '@/services/staffProfileService';
import type { Case, NextOfKinRelationship } from '@/types/case';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { recordCaseCreated } from '@/services/activityService';
import { canReadCases, canReadPickup, canCreateCase } from '@/services/authorizationPolicyService';
import { toPickupOnlyView } from '@/domain/cases/pickupView';

/**
 * Phase 15C (Wix Case Read Integration). Lists cases for one organization
 * — see docs/adr/ADR-013-wix-case-read-integration.md.
 *
 * In mock mode: filters services/__mocks__/fixtures.ts's caseFixtures by
 * organizationId (excluding soft-deleted) plus the optional search query —
 * byte-for-byte the same logic services/casesService.ts's list() always
 * ran. In practice, `casesService.list()` never actually calls this route
 * while dataAdapterMode is "mock" (it takes a local, zero-network path
 * instead, to stay consistent with create()/update()'s client-side
 * fixture mutations — see ADR-013) — this branch exists for defense-in-
 * depth and independent testability, matching every other Phase 15
 * Route Handler's symmetric mock/wix shape.
 *
 * In wix mode: queries the `cases` collection filtered by organizationId
 * and isArchived=false, maps each item via lib/wixCaseMapper.ts (skipping
 * malformed records rather than throwing), then applies the same search
 * filter server-side.
 *
 * Case list scalability, Phase 1 (2026-09) — pagination contract. Neither
 * `limit` nor `cursor` is required: a caller that omits both (every
 * existing caller today — casesService.ts's list()/the Dashboard) keeps
 * getting the complete, unbounded result set in `cases`, exactly the
 * shape it has always returned — except this is now genuinely complete.
 * Before this fix, the wix-mode branch below called
 * `queryWixDataItems` directly with no `paging` at all, which Wix Data
 * silently caps at 50 items (see lib/wixDataApi.ts's own comment on the
 * `rolePermissions` incident this is the same bug class as) — any
 * organization with more than 50 non-deleted cases was silently missing
 * everything past the 50th, with no error and no signal anywhere. The
 * "no limit/cursor" branch now loops via `queryAllWixDataItems` (the
 * same fix already applied to `rolePermissions`) instead of a single
 * capped call, so a caller that wants "everything" actually gets it.
 *
 * Passing `limit` (optionally with `cursor` for page 2+) opts into a
 * bounded page instead — `hasMore`/`nextCursor` tell the caller
 * explicitly whether more cases exist, so no consumer can mistake a
 * partial page for the complete collection. `nextCursor` is an opaque,
 * versioned, application-level token (lib/casePagination.ts) — never the
 * raw Wix cursor — bound to the exact `organizationId`/`searchQuery` it
 * was issued for, so it can't be tampered with or replayed against a
 * different query. This is additive only: the response shape gains
 * `hasMore`/`nextCursor`, `cases` is unchanged.
 *
 * Case list scalability, Phase 2 (2026-09) — server-side stage filtering
 * + search. `stage` is an exact `domain/cases/stages.ts#STAGES` label
 * (never a new/invented identifier — see that module's own
 * rawStagesForStageLabel, the single canonical raw<->display mapping this
 * route reuses rather than duplicating); an unrecognized value is a 400,
 * never a silent "All Cases" fallback. When supplied, it's translated to
 * the underlying `rawStage` value(s) and applied as part of the Wix/mock
 * FILTER — before sorting/pagination, never as a post-fetch check on an
 * already-paged result. `searchQuery`, in the bounded (`limit`/`cursor`)
 * mode, is likewise pushed into the filter (`buildCaseSearchWixFilter`/
 * `matchesCaseSearch`). Both now use a true substring match (`$contains`
 * in Wix, `.includes()` in mock), identical to the legacy branch's own
 * `matchesSearch` — so the two branches agree on what "this search"
 * means. They previously disagreed: the bounded path used `$startsWith`
 * on the mistaken premise that Wix had no substring operator, which made
 * a surname search miss any name it wasn't the first word of. See
 * lib/casePagination.ts's own CORRECTION note.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const searchQuery = url.searchParams.get('searchQuery') ?? '';
  const limitParam = url.searchParams.get('limit');
  const cursorParam = url.searchParams.get('cursor');
  const stageParam = url.searchParams.get('stage');

  if (!requestedOrganizationId) {
    return NextResponse.json({ cases: [], hasMore: false, nextCursor: null, error: 'organizationId is required.' }, { status: 400 });
  }

  let requestedLimit: number | null = null;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json(
        { cases: [], hasMore: false, nextCursor: null, error: 'limit must be a positive integer.' },
        { status: 400 },
      );
    }
    requestedLimit = parsed;
  }
  const paginationRequested = requestedLimit !== null || cursorParam !== null;

  // "All Cases" is never a persisted stage — no `stage` param at all is
  // the only way to request it; an unrecognized label is rejected
  // outright rather than silently treated as All Cases.
  let rawStages: number[] | null = null;
  if (stageParam !== null) {
    rawStages = rawStagesForStageLabel(stageParam);
    if (rawStages === null) {
      return NextResponse.json(
        { cases: [], hasMore: false, nextCursor: null, error: `Invalid stage. Must be one of: ${STAGES.join(', ')}.` },
        { status: 400 },
      );
    }
  }

  // Phase 15X (Multi-Tenant Authorization Hardening): re-derived from the
  // caller's session/membership, never trusted from the query param.
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  const adapter = getDataAdapterMode();
  const policyParams = { identityId: userId, organizationId, roleKey: role };

  try {
    // Manors launch-prep (Dispatch role): a caller with only `pickup.read`
    // (never `case.read`) gets a redacted view of every case in the list —
    // see domain/cases/pickupView.ts's own comment. The search filter
    // still runs against the full Case shape first (matchesSearch expects
    // full Case fields), redaction only happens on the response.
    const [hasFullRead, hasPickupOnlyRead] = await Promise.all([
      canReadCases(policyParams, adapter),
      canReadPickup(policyParams, adapter),
    ]);
    if (!hasFullRead && !hasPickupOnlyRead) {
      return NextResponse.json({ cases: [], hasMore: false, nextCursor: null, error: 'Not authorized to view cases for this organization.' }, { status: 403 });
    }

    // Cursor validated once, centrally, before either adapter branch —
    // rejected outright (400) rather than silently falling back to page 1
    // or leaking a mismatched page. The cursor's own embedded
    // organizationId/searchQuery/stage/kind must match this exact
    // request's server-derived context; even if that check were somehow
    // bypassed, both branches below always re-apply the server-derived
    // organizationId as their own query filter regardless of what a
    // cursor claims, so a forged/foreign cursor still can never surface
    // another organization's cases.
    let cursor: { wix?: string; mockOffset?: number } | null = null;
    if (cursorParam !== null) {
      const validation = validateCaseCursor(cursorParam, { organizationId, searchQuery, stage: stageParam, kind: adapter === 'mock' ? 'mock' : 'wix' });
      if (!validation.ok) {
        return NextResponse.json(
          { cases: [], hasMore: false, nextCursor: null, error: 'Invalid or expired pagination cursor.' },
          { status: 400 },
        );
      }
      cursor = validation.payload.kind === 'wix' ? { wix: validation.payload.wixCursor } : { mockOffset: validation.payload.offset };
    }

    if (adapter === 'mock') {
      const eligible = caseFixtures.filter(
        (c) => c.organizationId === organizationId && !c.isDeleted && (rawStages === null || rawStages.includes(c.rawStage)),
      );

      if (!paginationRequested) {
        // Legacy/default shape: unchanged order and search mechanism —
        // mock mode's in-memory filter never had the Wix 50-item cap to
        // begin with; only the (new, opt-in) stage filter is new here.
        const filtered = eligible.filter((c) => matchesSearch(c, searchQuery));
        return NextResponse.json({
          cases: hasFullRead ? filtered : filtered.map(toPickupOnlyView),
          hasMore: false,
          nextCursor: null,
        });
      }

      const searched = eligible.filter((c) => matchesCaseSearch(c, searchQuery));
      const sorted = [...searched].sort(compareCasesForListSort);
      const offset = cursor?.mockOffset ?? 0;
      const pageSize = clampCaseListPageSize(requestedLimit);
      const page = sorted.slice(offset, offset + pageSize);
      const hasMore = offset + page.length < sorted.length;
      const nextCursor = hasMore
        ? encodeCaseCursor({ v: 1, kind: 'mock', organizationId, searchQuery, stage: stageParam, offset: offset + page.length })
        : null;

      return NextResponse.json({ cases: hasFullRead ? page : page.map(toPickupOnlyView), hasMore, nextCursor });
    }

    if (!paginationRequested) {
      // Legacy/default shape: now genuinely complete (loops through every
      // Wix page via queryAllWixDataItems) instead of one silently-capped
      // call — see this function's own top comment. Order is left exactly
      // as before (Wix's own default, never specified) since nothing
      // downstream of this branch depends on a specific order; the
      // deterministic CASE_LIST_SORT only matters for the bounded-page
      // mode below, where stable ordering is what prevents a case from
      // being skipped or duplicated across pages. Stage filtering (new,
      // opt-in) is pushed into the same Wix filter; search stays
      // `matchesSearch` (`.includes()`), unchanged.
      const items = await queryAllWixDataItems<WixCaseItem>('cases', buildCaseListWixFilter({ organizationId, rawStages }));
      const cases = items
        .map((item) => mapWixCaseItem(item.data))
        .filter((c): c is Case => c !== null)
        .filter((c) => matchesSearch(c, searchQuery));

      return NextResponse.json({ cases: hasFullRead ? cases : cases.map(toPickupOnlyView), hasMore: false, nextCursor: null });
    }

    const pageSize = clampCaseListPageSize(requestedLimit);
    const searchFilter = buildCaseSearchWixFilter(searchQuery);
    const pageResponse = await queryWixDataItems<WixCaseItem>('cases', {
      filter: buildCaseListWixFilter({ organizationId, rawStages, searchFilter }),
      sort: CASE_LIST_SORT,
      // Wix's cursor-paging contract: the first page is requested via
      // `limit` alone, every subsequent page via `cursor` alone — never
      // both together (see lib/wixDataApi.ts's own comment). `cursor` here
      // is already the raw Wix-issued token (unwrapped by
      // validateCaseCursor above), never a client-supplied value. Per
      // Wix's own docs, `filter`/`sort` are ignored on a cursor-continuation
      // call anyway (locked in from the first page) — still passed here
      // for clarity/symmetry, since Wix accepts and ignores rather than
      // rejecting them.
      paging: cursor?.wix ? { cursor: cursor.wix } : { limit: pageSize },
    });

    const cases = pageResponse.dataItems
      .map((item) => mapWixCaseItem(item.data))
      .filter((c): c is Case => c !== null);
    // No post-fetch search re-filtering here, deliberately: the whole
    // point of buildCaseSearchWixFilter above is that Wix already applied
    // it — re-filtering client-side would silently mask a real mismatch
    // between assumed and actual Wix $startsWith behavior instead of
    // surfacing it.

    const nextWixCursor = pageResponse.pagingMetadata?.cursors?.next ?? null;
    const hasMore = Boolean(pageResponse.pagingMetadata?.hasNext) && nextWixCursor !== null;
    const nextCursor = hasMore
      ? encodeCaseCursor({ v: 1, kind: 'wix', organizationId, searchQuery, stage: stageParam, wixCursor: nextWixCursor! })
      : null;

    return NextResponse.json({ cases: hasFullRead ? cases : cases.map(toPickupOnlyView), hasMore, nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ cases: [], hasMore: false, nextCursor: null, error: message }, { status: 503 });
  }
}

/**
 * Phase 16 (Wix Write Integration). Creates a case, persisted to Wix — see
 * docs/adr/ADR-016-wix-write-integration.md.
 *
 * organizationId arrives in the body only as a *requested* value;
 * requireAuthorizedOrganization re-derives the trusted one from the
 * caller's own session/membership, exactly like every read route.
 *
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification):
 * `createdBy`/`intakeOwnerId` are no longer trusted from the client body at
 * all — this closed the "Known limitation, not resolved here" gap this
 * comment used to describe. Both are now resolved server-side via
 * `resolveStaffProfileForCaller`, the caller's own `StaffProfile` for this
 * organization (a 422 if none is linked, never a fabricated identity).
 * `assignedStaffId` remains client-suppliable (it may target someone other
 * than the caller — reassigning a case to a different handler at creation
 * time), but is validated via `assertAssignableStaffProfile` (`case.update`)
 * whenever it names someone other than the caller; defaulting to the
 * caller's own profile needs no separate check. This is not a
 * tenant/authorization boundary of its own: organizationId is still the
 * only value re-derived rather than trusted from the body.
 *
 * The workflow template is resolved entirely server-side — this
 * organization's first enabled template, exactly matching
 * hooks/useCreateCase.ts's existing "first enabled" selection rule — never
 * accepted from the request, so a case can never be created against
 * another organization's template or an unvalidated snapshot.
 *
 * This route requires DATA_ADAPTER=wix: mock-mode case creation stays on
 * casesService.create's existing client-side path (which never calls this
 * route at all — see services/casesService.ts), so there is no mock
 * branch to duplicate here. See the ADR for why this was a deliberate
 * simplification rather than an oversight.
 *
 * Phase 16B (Case Number Generation): the Case Number is reserved here,
 * server-side, via lib/wixCaseNumberSequence.ts's reserveNextCaseNumber —
 * never accepted from the request body (there is no client-supplied
 * caseNumber field at all; the New Case form has no such input). See
 * docs/adr/ADR-018-case-number-generation.md.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  // Phase 24 (Case Activity Timeline & Audit Center): one correlationId per
  // request — shared by every activity event this request produces.
  const correlationId = crypto.randomUUID();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ case: null, error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ case: null, error: 'Invalid request body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  // Phase 19A (Secure Payment Architecture): mandatory server-side
  // enforcement, checked before anything else in this handler — a forged
  // request naming a raw card field is rejected outright, never silently
  // dropped or persisted. See docs/adr/ADR-021-secure-payment-architecture.md.
  const forbiddenPaymentFields = findForbiddenPaymentFields(b);
  if (forbiddenPaymentFields.length > 0) {
    return NextResponse.json(
      { case: null, error: `Request must not contain payment card data (found: ${forbiddenPaymentFields.join(', ')}).` },
      { status: 400 },
    );
  }

  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ case: null, error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;
  const context = authResult.context;

  if (getDataAdapterMode() !== 'wix') {
    return NextResponse.json(
      { case: null, error: 'This endpoint requires DATA_ADAPTER=wix.' },
      { status: 400 },
    );
  }

  // Manors go-live fix: this route had no case.create check at all —
  // any authenticated org member could create a case regardless of role
  // (Dispatch/Read Only included, since neither holds it in the catalog).
  if (!(await canCreateCase({ identityId: context.userId, organizationId, roleKey: context.role }, 'wix'))) {
    return NextResponse.json({ case: null, error: 'Not authorized to create cases for this organization.' }, { status: 403 });
  }

  const requiredStringFields = ['decedentName', 'nextOfKinName', 'nextOfKinPhone'];
  const missingOrInvalid = requiredStringFields.filter(
    (key) => typeof b[key] !== 'string' || (b[key] as string).trim() === '',
  );
  if (missingOrInvalid.length > 0) {
    return NextResponse.json(
      { case: null, error: `Invalid or missing required field(s): ${missingOrInvalid.join(', ')}` },
      { status: 400 },
    );
  }
  const optionalStringFields = ['dateOfBirth', 'dateOfDeath', 'timeOfDeath', 'placeOfDeath', 'weight', 'assignedStaffId'];
  const badOptional = optionalStringFields.filter((key) => key in b && typeof b[key] !== 'string');
  if (badOptional.length > 0) {
    return NextResponse.json(
      { case: null, error: `Invalid field(s): ${badOptional.join(', ')}` },
      { status: 400 },
    );
  }
  if ('fieldValues' in b && (typeof b.fieldValues !== 'object' || b.fieldValues === null || Array.isArray(b.fieldValues))) {
    return NextResponse.json({ case: null, error: 'Invalid field(s): fieldValues' }, { status: 400 });
  }

  // Task #15 (2026-09, future-historical-date validation): server-side
  // backstop against a bypassed/forged request — the client (NewCaseModal)
  // already blocks this in the common case, but a direct POST must be
  // rejected too. "Today" is resolved in the organization's own local
  // timezone (resolveOrgLocalToday — same Intl.DateTimeFormat + timezone
  // technique domain/cases/caseNumber.ts#orgLocalYear already established
  // for case-number year rollover, inheriting that same authoritative
  // source and its known limitations rather than inventing a new one).
  // Only fetched when actually needed, to avoid an extra Wix read on every
  // case creation that doesn't supply either date.
  let organization: Awaited<ReturnType<typeof getOrganization>> | undefined;
  if (typeof b.dateOfBirth === 'string' || typeof b.dateOfDeath === 'string') {
    organization = await getOrganization(organizationId, 'wix');
    const orgToday = resolveOrgLocalToday(new Date().toISOString(), organization?.timezone);
    if (typeof b.dateOfBirth === 'string') {
      const dobError = getDateOfBirthFutureError(b.dateOfBirth, orgToday);
      if (dobError) return NextResponse.json({ case: null, error: dobError }, { status: 400 });
    }
    if (typeof b.dateOfDeath === 'string') {
      const dodError = getDateOfDeathFutureError(b.dateOfDeath, orgToday);
      if (dodError) return NextResponse.json({ case: null, error: dodError }, { status: 400 });
    }
  }

  // Historical Arrangement import (2026-09) — narrow migration exception
  // only. This is NEVER a general client-editable case-number field: it
  // must be a valid, signed, short-lived authorization minted by
  // app/api/cases/historical-jotform-import/route.ts's own server code
  // right after it fetched and validated a real Jotform submission — see
  // lib/auth/historicalCaseNumberAuthorization.ts's own comment for why a
  // bare permission-gated case-number field alone isn't sufficient.
  if ('historicalCaseNumberAuthorization' in b && typeof b.historicalCaseNumberAuthorization !== 'string') {
    return NextResponse.json({ case: null, error: 'Invalid field(s): historicalCaseNumberAuthorization' }, { status: 400 });
  }

  // Manors launch-prep: NOK email is optional, but must be a reasonably-
  // formatted address if provided at all — trimmed; an empty string after
  // trimming is treated the same as omitting it entirely.
  let nextOfKinEmail: string | null = null;
  if ('nextOfKinEmail' in b) {
    if (typeof b.nextOfKinEmail !== 'string') {
      return NextResponse.json({ case: null, error: 'Invalid field(s): nextOfKinEmail' }, { status: 400 });
    }
    const trimmed = b.nextOfKinEmail.trim();
    if (trimmed !== '') {
      if (!isValidEmail(trimmed)) {
        return NextResponse.json({ case: null, error: 'nextOfKinEmail must be a valid email address.' }, { status: 400 });
      }
      nextOfKinEmail = trimmed;
    }
  }

  // Manors launch-prep: relationship is optional at creation — unknown at
  // intake is fine, updated later. 'other' pairs with a short free-text
  // description, validated the same way any other optional string is.
  let nextOfKinRelationship: NextOfKinRelationship | null = null;
  if ('nextOfKinRelationship' in b) {
    if (b.nextOfKinRelationship !== null && !isValidNextOfKinRelationship(b.nextOfKinRelationship)) {
      return NextResponse.json({ case: null, error: 'Invalid field(s): nextOfKinRelationship' }, { status: 400 });
    }
    nextOfKinRelationship = (b.nextOfKinRelationship as NextOfKinRelationship | null) ?? null;
  }
  let nextOfKinRelationshipOther: string | null = null;
  if ('nextOfKinRelationshipOther' in b) {
    if (typeof b.nextOfKinRelationshipOther !== 'string') {
      return NextResponse.json({ case: null, error: 'Invalid field(s): nextOfKinRelationshipOther' }, { status: 400 });
    }
    nextOfKinRelationshipOther = b.nextOfKinRelationshipOther.trim() || null;
  }

  // Structured Certifier data (2026-09, ADR-041) — all four optional at
  // creation, plain trimmed nullable strings with no format validation at
  // this layer, matching nextOfKinRelationshipOther/nextOfKinPhone's own
  // posture exactly (no phone-masking convention exists anywhere in SOLIS).
  let certifierName: string | null = null;
  if ('certifierName' in b) {
    if (typeof b.certifierName !== 'string') {
      return NextResponse.json({ case: null, error: 'Invalid field(s): certifierName' }, { status: 400 });
    }
    certifierName = b.certifierName.trim() || null;
  }
  let certifierPhone: string | null = null;
  if ('certifierPhone' in b) {
    if (typeof b.certifierPhone !== 'string') {
      return NextResponse.json({ case: null, error: 'Invalid field(s): certifierPhone' }, { status: 400 });
    }
    certifierPhone = b.certifierPhone.trim() || null;
  }
  let certifierLicenseNumber: string | null = null;
  if ('certifierLicenseNumber' in b) {
    if (typeof b.certifierLicenseNumber !== 'string') {
      return NextResponse.json({ case: null, error: 'Invalid field(s): certifierLicenseNumber' }, { status: 400 });
    }
    certifierLicenseNumber = b.certifierLicenseNumber.trim() || null;
  }
  let certifierFax: string | null = null;
  if ('certifierFax' in b) {
    if (typeof b.certifierFax !== 'string') {
      return NextResponse.json({ case: null, error: 'Invalid field(s): certifierFax' }, { status: 400 });
    }
    certifierFax = b.certifierFax.trim() || null;
  }

  // Conditional shipping/tracking (2026-09): optional at intake — a family
  // may not have decided yet. Omitted (or explicitly null/undefined)
  // defaults to 'undecided' in buildWixCaseData below, never 'pickup'. No
  // shipping-detail field (carrier/tracking number/date shipped) is ever
  // accepted here — they aren't part of this request body's schema at all,
  // by construction, so Shipping can be selected at intake with zero
  // tracking information required.
  let returnMethod: ReturnMethod | undefined;
  if ('returnMethod' in b && b.returnMethod !== null && b.returnMethod !== undefined) {
    if (!isValidReturnMethod(b.returnMethod)) {
      return NextResponse.json({ case: null, error: 'Invalid field(s): returnMethod' }, { status: 400 });
    }
    returnMethod = b.returnMethod;
  }

  const callerProfile = await resolveStaffProfileForCaller(context, 'wix');
  if (!callerProfile) {
    // Solis go-live diagnostics: the client-visible message is already
    // specific and safe to show as-is (see services/casesService.ts's
    // error-surfacing fix), but this is logged server-side too since a
    // missing StaffProfile link is a data-state issue worth being able to
    // trace back to a specific identity/org without digging through Wix.
    console.error(
      `[POST /api/cases] No StaffProfile linked for identityId=${context.userId} organizationId=${organizationId} correlationId=${correlationId}`,
    );
    return NextResponse.json(
      { case: null, error: 'No StaffProfile is linked to your account in this organization.' },
      { status: 422 },
    );
  }

  // Manors go-live fix: assigning a case to yourself needs nothing beyond
  // case.create (already checked above) — only naming a DIFFERENT staff
  // member requires the narrower case.reassign permission. Office Staff
  // holds case.create but not case.reassign, so they can create a case
  // (defaulting to themselves) but cannot hand it to someone else here.
  if (typeof b.assignedStaffId === 'string' && b.assignedStaffId !== callerProfile.id) {
    try {
      await assertAssignableStaffProfile(
        { organizationId, staffProfileId: b.assignedStaffId, permission: 'case.reassign', actor: { identityId: context.userId, organizationId, roleKey: context.role } },
        'wix',
      );
    } catch (error) {
      const message = error instanceof StaffAssignmentError ? error.message : 'Failed to validate assignedStaffId.';
      return NextResponse.json({ case: null, error: message }, { status: 422 });
    }
  }

  try {
    const templates = await fetchWixWorkflowTemplates(organizationId);
    const template = templates.find((t) => t.isEnabled);
    if (!template) {
      return NextResponse.json(
        { case: null, error: `No enabled workflow template found for this organization.` },
        { status: 422 },
      );
    }
    const version = latestTemplateVersion(template);

    const beaconCaseId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const createdBy = callerProfile.id;
    const intakeOwnerId = callerProfile.id;
    const assignedStaffId = typeof b.assignedStaffId === 'string' ? b.assignedStaffId : createdBy;

    let caseNumber: string;
    // Set only on the historical-import path, so the sequence counter can
    // be advanced past the preserved number after the Case is created —
    // see the `historicalPreservedCaseNumber` block below.
    let historicalPreservedCaseNumber: string | null = null;
    if (typeof b.historicalCaseNumberAuthorization === 'string') {
      // Historical Arrangement import (2026-09) — the ONLY path that ever
      // skips reserveNextCaseNumber. Anything invalid/expired/mismatched
      // is rejected outright; this never silently falls back to normal
      // allocation, which would substitute a different, unannounced
      // case number than the one staff expects.
      const authPayload = await verifyHistoricalCaseNumberAuthorization(b.historicalCaseNumberAuthorization);
      if (!authPayload || authPayload.organizationId !== organizationId) {
        return NextResponse.json(
          { case: null, error: 'Invalid or expired historical case-number authorization.' },
          { status: 403 },
        );
      }

      // Authoritative, final duplicate check — never create a second Case
      // sharing a preserved historical number, regardless of any earlier
      // check the historical-import route itself already ran.
      const existingWithNumber = await queryWixDataItems<WixCaseItem>('cases', {
        filter: { organizationId, caseNumber: authPayload.caseNumber },
        paging: { limit: 1 },
      });
      if (existingWithNumber.dataItems.length > 0) {
        const existingCase = mapWixCaseItem(existingWithNumber.dataItems[0].data);
        return NextResponse.json(
          {
            case: null,
            error: 'A Case with this historical case number already exists.',
            historicalDuplicate: true,
            existingCaseId: existingCase?.id ?? null,
          },
          { status: 409 },
        );
      }

      caseNumber = authPayload.caseNumber;
      historicalPreservedCaseNumber = caseNumber;
    } else {
      // Manors launch-prep — P0: the case-number year is the organization's
      // own LOCAL calendar year, never the server's/UTC's, so a case created
      // just after local midnight on Jan 1 gets the new year's prefix — see
      // domain/cases/caseNumber.ts#orgLocalYear. Reuses the same
      // organization fetched above for date validation when one already
      // happened (Task #15), rather than fetching it a second time.
      organization ??= await getOrganization(organizationId, 'wix');
      caseNumber = await reserveNextCaseNumber(organizationId, orgLocalYear(createdAt, organization?.timezone));
    }

    const data = buildWixCaseData({
      beaconCaseId,
      organizationId,
      caseNumber,
      caseType: version.caseTypes[0],
      workflowTemplateId: template.id,
      workflowTemplateVersion: version.version,
      workflowSnapshot: buildCaseWorkflowSnapshot(template, version),
      intakeOwnerId,
      createdBy,
      assignedStaffId,
      decedentName: b.decedentName as string,
      dateOfBirth: (b.dateOfBirth as string) ?? '—',
      dateOfDeath: (b.dateOfDeath as string) ?? '—',
      timeOfDeath: (b.timeOfDeath as string) ?? '—',
      placeOfDeath: (b.placeOfDeath as string) ?? '—',
      weight: (b.weight as string) ?? '—',
      nextOfKinName: b.nextOfKinName as string,
      nextOfKinPhone: b.nextOfKinPhone as string,
      nextOfKinEmail,
      nextOfKinRelationship,
      nextOfKinRelationshipOther,
      certifierName,
      certifierPhone,
      certifierLicenseNumber,
      certifierFax,
      fieldValues: (b.fieldValues as Record<number, string>) ?? {},
      createdAt,
      returnMethod,
    });

    const inserted = await insertWixDataItem<WixCaseItem>('cases', data, beaconCaseId);
    const created = mapWixCaseItem(inserted.data);
    if (!created) {
      // Solis go-live diagnostics: mapWixCaseItem fails closed with no
      // reason by design (safe for the read path), which left this branch
      // completely opaque. Log exactly which field(s) didn't round-trip so
      // a future "Failed to create case." report is traceable without
      // guessing — never returned to the client.
      console.error(
        `[POST /api/cases] mapWixCaseItem returned null after insert, beaconCaseId=${beaconCaseId} organizationId=${organizationId} correlationId=${correlationId}. Failures: ${describeMapWixCaseItemFailure(inserted.data).join('; ')}`,
      );
      return NextResponse.json({ case: null, error: 'Failed to create case.' }, { status: 500 });
    }

    // Historical-import sequence safety (2026-10). The preserved number
    // above was NOT allocated by reserveNextCaseNumber, so the counter is
    // still wherever it was — if the imported number is at or above it,
    // the counter is now BEHIND reality and the next normally-allocated
    // case would be handed a number that already exists. Observed live
    // for Manors: importing B2026-036 left nextSequence at 36.
    //
    // Best-effort by necessity: the Case is already inserted at this
    // point, so throwing here would report a failure for a case that in
    // fact exists. A failure is logged loudly and remains repairable from
    // Settings > Case Numbering (the resync action), which recomputes the
    // same correction from the Cases collection itself.
    if (historicalPreservedCaseNumber) {
      try {
        const parsed = parseCaseNumber(historicalPreservedCaseNumber);
        if (parsed) {
          await advanceCaseSequencePast(organizationId, parsed.year, parsed.sequence);
        } else {
          console.error(
            `[POST /api/cases] Could not parse preserved historical case number "${historicalPreservedCaseNumber}" to advance the sequence, organizationId=${organizationId} correlationId=${correlationId}.`,
          );
        }
      } catch (error) {
        console.error(
          `[POST /api/cases] Failed to advance the case-number sequence past imported ${historicalPreservedCaseNumber}, organizationId=${organizationId} correlationId=${correlationId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Phase 24: best-effort — an activity-log failure never fails the
    // actual case creation, matching this codebase's existing convention
    // for non-critical side effects (see app/api/auth/invitations/route.ts's
    // message-send try/catch).
    try {
      await recordCaseCreated(
        { organizationId, actorIdentityId: context.userId, actorMembershipId: null, actorRoleKey: context.role, correlationId },
        created.id,
        { caseNumber: created.caseNumber, decedentName: created.decedentName },
        'wix',
      );
    } catch (error) {
      console.error('Failed to record case.created activity event:', error instanceof Error ? error.message : error);
    }

    return NextResponse.json({ case: created }, { status: 201 });
  } catch (error) {
    // Solis go-live diagnostics: log the full error (message + stack) so an
    // unexpected Wix/network failure is traceable server-side, even though
    // only the short message is ever returned to the client.
    console.error(`[POST /api/cases] Unhandled error, correlationId=${correlationId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ case: null, error: message }, { status: 503 });
  }
}
