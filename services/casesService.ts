import type { OrganizationContext } from '../types/organization';
import type { Case, CaseUpdate, NewCaseInput } from '../types/case';
import type { Session } from '../types/session';
import type { WorkflowTemplate } from '../types/workflowTemplate';
import type { DataAdapterMode } from '../lib/env';
import { assertIntakeOwnerUnchanged, assertCreatedByUnchanged } from '../domain/cases/intakeOwnership';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '../domain/workflow/snapshot';
import { formatCaseNumber, parseCaseNumber, assertCaseNumberUnchanged } from '../domain/cases/caseNumber';
import { assertStaffProfileIsActiveAndInOrganization } from './staffProfileService';
import { caseFixtures } from './__mocks__/fixtures';
import { queryAllWixDataItems } from '../lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '../lib/wixCaseMapper';
import { DEFAULT_RETURN_METHOD } from '../domain/cases/returnMethod';
import { assertValidPickupReleasePatch } from '../domain/cases/pickupRelease';
import { normalizeCaseTextFields, normalizeCaseFieldValues } from '../domain/cases/textNormalization';
import { deriveCaseFieldSyncFromFieldValues } from '../domain/workflow/resolveIntake';
import { getDateOfBirthFutureError, getDateOfDeathFutureError, getFutureDateError } from '../utils/inputMask';
import { reconcileCaseWorkflow } from './workflowReconciliationService';
import { STAGES, rawStagesForDisplayStage, rawStagesForStageLabel } from '../domain/cases/stages';
import {
  clampCaseListPageSize,
  compareCasesForListSort,
  encodeCaseCursor,
  matchesSearchStartsWith,
  validateCaseCursor,
} from '../lib/casePagination';

export type CaseFilters = {
  searchQuery?: string;
};

/**
 * Case list scalability, Phase 3 (2026-09). The bounded/stage/search-aware
 * counterpart to `list()` above, backing the Dashboard's tabbed case list
 * (hooks/useCaseListPage.ts). Mirrors `list()`'s own mock/wix split
 * exactly, for the same reason documented there: mock mode's
 * create()/update() mutate the BROWSER's own in-memory `caseFixtures`, so
 * a mock-mode read must also run locally in the browser — fetching
 * `/api/cases` would hit the Next.js SERVER's own separate `caseFixtures`
 * module instance, which never sees those local mutations. This is why
 * the mock branch re-implements the exact same stage/search/pagination
 * logic `app/api/cases/route.ts`'s own mock branch has, rather than
 * calling it — the two are deliberately kept in lockstep via the shared,
 * pure `lib/casePagination.ts` helpers (sort comparator, cursor
 * encode/decode, $startsWith-equivalent search), never independently
 * reimplemented field-by-field.
 */
export type CaseListPage = { cases: Case[]; hasMore: boolean; nextCursor: string | null };

export type CaseListPageFilters = {
  stage?: string | null;
  searchQuery?: string;
  limit?: number;
  cursor?: string | null;
};

function listPageMock(context: OrganizationContext, filters: CaseListPageFilters): CaseListPage {
  const searchQuery = filters.searchQuery ?? '';
  const stage = filters.stage ?? null;
  const rawStages = stage ? rawStagesForStageLabel(stage) : null;
  if (stage && rawStages === null) {
    // An unrecognized stage never silently falls back to "All Cases" —
    // matches app/api/cases/route.ts's own 400 behavior in spirit (the
    // caller here has no HTTP status to return, so an empty page is the
    // closest local equivalent to "there is nothing to show").
    return { cases: [], hasMore: false, nextCursor: null };
  }

  const eligible = caseFixtures.filter(
    (c) => c.organizationId === context.organizationId && !c.isDeleted && (rawStages === null || rawStages.includes(c.rawStage)),
  );
  const searched = eligible.filter((c) => matchesSearchStartsWith(c, searchQuery));
  const sorted = [...searched].sort(compareCasesForListSort);

  let offset = 0;
  if (filters.cursor) {
    const validation = validateCaseCursor(filters.cursor, { organizationId: context.organizationId, searchQuery, stage, kind: 'mock' });
    if (!validation.ok || validation.payload.kind !== 'mock') {
      return { cases: [], hasMore: false, nextCursor: null };
    }
    offset = validation.payload.offset;
  }

  const pageSize = clampCaseListPageSize(filters.limit ?? null);
  const page = sorted.slice(offset, offset + pageSize);
  const hasMore = offset + page.length < sorted.length;
  const nextCursor = hasMore
    ? encodeCaseCursor({ v: 1, kind: 'mock', organizationId: context.organizationId, searchQuery, stage, offset: offset + page.length })
    : null;

  return { cases: page, hasMore, nextCursor };
}

export async function listPage(
  context: OrganizationContext,
  filters: CaseListPageFilters = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<CaseListPage> {
  if (dataAdapterMode === 'mock') {
    return listPageMock(context, filters);
  }

  const params = new URLSearchParams({ organizationId: context.organizationId });
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.searchQuery) params.set('searchQuery', filters.searchQuery);
  params.set('limit', String(clampCaseListPageSize(filters.limit ?? null)));
  if (filters.cursor) params.set('cursor', filters.cursor);

  const response = await fetch(`/api/cases?${params.toString()}`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? 'Failed to load cases.');
  }
  return body as CaseListPage;
}

/**
 * Case list scalability, Phase 3 (2026-09). Tab counts for the Dashboard —
 * see app/api/cases/counts/route.ts's own comment for the Wix-side
 * ("Count Data Items", no record payload) design. Same mock/wix split as
 * `listPage` above, for the identical reason.
 */
export type CaseCounts = { total: number; byStage: Record<string, number> };

export async function counts(
  context: OrganizationContext,
  searchQuery: string = '',
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<CaseCounts> {
  if (dataAdapterMode === 'mock') {
    const eligible = caseFixtures.filter(
      (c) => c.organizationId === context.organizationId && !c.isDeleted && matchesSearchStartsWith(c, searchQuery),
    );
    const byStage: Record<string, number> = {};
    STAGES.forEach((label, displayStage) => {
      const rawStages = rawStagesForDisplayStage(displayStage);
      byStage[label] = eligible.filter((c) => rawStages.includes(c.rawStage)).length;
    });
    return { total: eligible.length, byStage };
  }

  const params = new URLSearchParams({ organizationId: context.organizationId });
  if (searchQuery) params.set('searchQuery', searchQuery);

  const response = await fetch(`/api/cases/counts?${params.toString()}`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? 'Failed to load case counts.');
  }
  return body as CaseCounts;
}

/**
 * Mock implementation backed by services/__mocks__/fixtures.ts. Every
 * function filters by `context.organizationId` for real — a call with a
 * mismatched organizationId returns empty/not-found rather than assuming
 * isolation, per docs/adr/ADR-002-multi-tenant-architecture.md.
 *
 * Phase 15C (Wix Case Read Integration): list()/get() gained a
 * `dataAdapterMode` parameter (see docs/adr/ADR-013), read from
 * useOrganization()'s server-resolved value (hooks/useOrganization.tsx),
 * never from a client-side env var read. When it's "mock" (the default,
 * for any caller not yet passing it), this runs the *exact same*
 * fixture-filtering code that ran here before this phase — zero behavior
 * change, no network call, still sharing state with create()/update()
 * below.
 *
 * Phase 16 (Wix Write Integration): create()/update() gained the exact
 * same `dataAdapterMode` parameter, for the exact same reason — see
 * docs/adr/ADR-016. When "mock" (the default), both run the *unchanged*
 * pre-Phase-16 fixture-mutating code below, byte for byte. When "wix",
 * they instead POST/PATCH app/api/cases' Route Handlers, which alone
 * write to Wix and are the only place organizationId is ever re-verified
 * against the caller's session (see
 * lib/auth/requireAuthorizedOrganization.ts) — this service never adds
 * its own authorization logic, it only calls the Route Handler.
 */

export function matchesSearch(case_: Case, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    case_.decedentName.toLowerCase().includes(q) ||
    case_.nextOfKinPhone.toLowerCase().includes(q) ||
    (case_.nextOfKinEmail?.toLowerCase().includes(q) ?? false) ||
    case_.caseNumber.toLowerCase().includes(q) ||
    (case_.tagNumber?.toLowerCase().includes(q) ?? false) ||
    case_.id.includes(q)
  );
}

/**
 * Phase 16B (Case Number Generation), mock-mode side: scans this
 * organization's existing case numbers for the given year and returns the
 * next one. Mock case creation is single-threaded (one browser tab, no
 * real concurrent writers), so a plain scan-and-increment is safe here —
 * the concurrency-safe mechanism this feature requires only matters for
 * the real, multi-client Wix-mode path; see
 * lib/wixCaseNumberSequence.ts's reserveNextCaseNumber for that one.
 */
function nextMockCaseNumber(organizationId: string, year: number): string {
  const highestSequence = caseFixtures
    .filter((c) => c.organizationId === organizationId)
    .reduce((max, c) => {
      const parsed = parseCaseNumber(c.caseNumber);
      return parsed && parsed.year === year && parsed.sequence > max ? parsed.sequence : max;
    }, 0);
  return formatCaseNumber(year, highestSequence + 1);
}

function listMock(context: OrganizationContext, filters: CaseFilters): Case[] {
  return caseFixtures.filter(
    (c) =>
      c.organizationId === context.organizationId &&
      !c.isDeleted &&
      matchesSearch(c, filters.searchQuery ?? ''),
  );
}

export async function list(
  context: OrganizationContext,
  filters: CaseFilters = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Case[]> {
  if (dataAdapterMode === 'mock') {
    return listMock(context, filters);
  }

  const params = new URLSearchParams({ organizationId: context.organizationId });
  if (filters.searchQuery) params.set('searchQuery', filters.searchQuery);

  const response = await fetch(`/api/cases?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to load cases.');
  }
  const body = (await response.json()) as { cases: Case[] };
  return body.cases;
}

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). A server-safe
 * counterpart to `list()` above — discovered necessary during this
 * phase's live Wix verification. `list()`'s own `wix`-mode branch is a
 * client-only HTTP wrapper (a relative-path `fetch('/api/cases?...')`,
 * meant for `hooks/useCases.ts` running in a browser, where the real
 * Wix-querying logic actually lives inside `app/api/cases/route.ts`'s own
 * `GET` handler) — calling it from server-side code throws
 * `TypeError: Failed to parse URL`, since a relative URL has no origin to
 * resolve against outside a browser. `services/reportingService.ts`
 * (which runs inside Route Handlers, never a browser) calls this function
 * instead, mirroring `services/scheduling/appointmentReads.ts`'s own
 * precedent for exactly this "a server-side consumer needs a direct read,
 * not the client's own HTTP wrapper" reason. Never duplicates
 * `app/api/cases/route.ts`'s own Wix query — that route should be
 * refactored to call this same function in a later pass, but is left
 * unchanged here since it works correctly today and this phase's own
 * scope is reporting, not cases-route internals.
 *
 * Case list scalability, Phase 1 (2026-09): this had the identical
 * silent-cap defect GET /api/cases did — a single `queryWixDataItems`
 * call with no `paging`, capped by Wix Data at 50 items (see
 * lib/wixDataApi.ts's own comment on the `rolePermissions` incident this
 * is the same bug class as), so reporting for any organization past 50
 * non-deleted cases was silently computed over an incomplete set. Now
 * loops via `queryAllWixDataItems` (the same fix already applied to
 * `rolePermissions`) to return the genuinely complete set — this
 * function's signature/contract (`Promise<Case[]>`, still every case, no
 * pagination surfaced to its callers) is unchanged.
 */
export async function listForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode = 'mock'): Promise<Case[]> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.filter((c) => c.organizationId === organizationId && !c.isDeleted);
  }
  const items = await queryAllWixDataItems<WixCaseItem>('cases', { organizationId, isArchived: false });
  return items.map((item) => mapWixCaseItem(item.data)).filter((c): c is Case => c !== null);
}

export async function get(
  context: OrganizationContext,
  caseId: string,
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return (
      caseFixtures.find(
        (c) => c.id === caseId && c.organizationId === context.organizationId && !c.isDeleted,
      ) ?? null
    );
  }

  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}?organizationId=${encodeURIComponent(context.organizationId)}`,
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Failed to load case.');
  }
  const body = (await response.json()) as { case: Case | null };
  return body.case;
}

/**
 * `session` and `template` are separate, trusted parameters — never folded
 * into `input` — specifically so `createdBy`/`intakeOwnerId` (from
 * session) and `workflowTemplateId`/`workflowTemplateVersion`/
 * `workflowSnapshot` (from template) can never be supplied by the New Case
 * form. `createdBy`/`intakeOwnerId` are derived from `session.staffId`, the
 * only source of truth for "who is taking this call." `assignedStaffId`
 * also defaults to it (matching design/support.js's `owner: createdBy`)
 * unless the caller explicitly overrides it via `input.assignedStaffId`.
 * `template` is the caller's already-resolved WorkflowTemplate (see
 * hooks/useCreateCase.ts's "workflow selection logic" — which enabled
 * template applies) — this function only snapshots whichever one it's
 * given, it doesn't do the choosing itself.
 */
export async function create(
  context: OrganizationContext,
  input: NewCaseInput,
  session: Session,
  template: WorkflowTemplate,
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Case> {
  if (dataAdapterMode === 'wix') {
    const response = await fetch('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: context.organizationId,
        decedentName: input.decedentName,
        nextOfKinName: input.nextOfKinName,
        nextOfKinPhone: input.nextOfKinPhone,
        nextOfKinEmail: input.nextOfKinEmail,
        nextOfKinRelationship: input.nextOfKinRelationship,
        nextOfKinRelationshipOther: input.nextOfKinRelationshipOther,
        certifierName: input.certifierName,
        certifierPhone: input.certifierPhone,
        certifierLicenseNumber: input.certifierLicenseNumber,
        certifierFax: input.certifierFax,
        dateOfBirth: input.dateOfBirth,
        dateOfDeath: input.dateOfDeath,
        timeOfDeath: input.timeOfDeath,
        placeOfDeath: input.placeOfDeath,
        weight: input.weight,
        assignedStaffId: input.assignedStaffId ?? session.staffId,
        fieldValues: input.fieldValues,
        createdBy: session.staffId,
        intakeOwnerId: session.staffId,
        returnMethod: input.returnMethod,
      }),
    });
    if (!response.ok) {
      // Manors go-live fix: this used to always throw the same generic
      // message, discarding whatever specific, already-safe-to-display
      // error the route handler returned (e.g. "No StaffProfile is linked
      // to your account in this organization.") — the exact reason for a
      // real production "Failed to create case." report. The route only
      // ever returns short, user-appropriate strings (never a stack trace
      // or raw Wix error), so surfacing `body.error` directly is safe.
      let message = 'Failed to create case.';
      try {
        const errorBody = (await response.json()) as { error?: string };
        if (typeof errorBody?.error === 'string' && errorBody.error.trim() !== '') {
          message = errorBody.error;
        }
      } catch {
        // Response body wasn't valid JSON — fall back to the generic message.
      }
      throw new Error(message);
    }
    const body = (await response.json()) as { case: Case };
    return body.case;
  }

  // Task #15 (2026-09, future-historical-date validation): mirrors the
  // Wix-mode route's own check (app/api/cases/route.ts) — mock mode is
  // exercised entirely client-side, so the browser's own local "now" is
  // already the correct reference clock (no organization-timezone lookup
  // needed the way the server-side Wix route requires).
  if (typeof input.dateOfBirth === 'string') {
    const error = getDateOfBirthFutureError(input.dateOfBirth);
    if (error) throw new Error(error);
  }
  if (typeof input.dateOfDeath === 'string') {
    const error = getDateOfDeathFutureError(input.dateOfDeath);
    if (error) throw new Error(error);
  }

  if (input.assignedStaffId) {
    await assertStaffProfileIsActiveAndInOrganization(context.organizationId, input.assignedStaffId, 'mock');
  }

  const version = latestTemplateVersion(template);
  const creationYear = new Date().getFullYear();
  const workflowSnapshot = buildCaseWorkflowSnapshot(template, version);
  // SOLIS-wide ALL-CAPS data standard (2026-09): mirrors
  // lib/wixCaseMapper.ts#buildWixCaseData's normalization exactly, so
  // dev/test behavior (DATA_ADAPTER=mock) never diverges from production.
  const normalized = normalizeCaseTextFields({
    decedentName: input.decedentName,
    placeOfDeath: input.placeOfDeath ?? '—',
    nextOfKinName: input.nextOfKinName,
    nextOfKinRelationshipOther: input.nextOfKinRelationshipOther?.trim() || null,
    certifierName: input.certifierName?.trim() || null,
    certifierLicenseNumber: input.certifierLicenseNumber?.trim() || null,
  });
  const newCase: Case = {
    id: String(1000 + caseFixtures.length + 42), // simple mock id scheme; a real backend assigns this
    organizationId: context.organizationId,
    caseNumber: nextMockCaseNumber(context.organizationId, creationYear),
    decedentName: normalized.decedentName as string,
    dateOfBirth: input.dateOfBirth ?? '—',
    dateOfDeath: input.dateOfDeath ?? '—',
    timeOfDeath: input.timeOfDeath ?? '—',
    placeOfDeath: normalized.placeOfDeath as string,
    weight: input.weight ?? '—',
    rawStage: 0,
    assignedStaffId: input.assignedStaffId ?? session.staffId,
    nextOfKinName: normalized.nextOfKinName as string,
    nextOfKinPhone: input.nextOfKinPhone,
    nextOfKinEmail: input.nextOfKinEmail?.trim() || null,
    nextOfKinRelationship: input.nextOfKinRelationship ?? null,
    nextOfKinRelationshipOther: normalized.nextOfKinRelationshipOther as string | null,
    certifierName: normalized.certifierName as string | null,
    certifierPhone: input.certifierPhone?.trim() || null,
    certifierLicenseNumber: normalized.certifierLicenseNumber as string | null,
    certifierFax: input.certifierFax?.trim() || null,
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    vaNotificationResponsibility: null,
    tagNumber: null,
    checklistState: {},
    fieldValues: normalizeCaseFieldValues(input.fieldValues ?? {}, workflowSnapshot) ?? {},
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
    pickupNote: null,
    returnMethod: input.returnMethod ?? DEFAULT_RETURN_METHOD,
    shippingCarrier: null,
    shippingTrackingNumber: null,
    shippingDateShipped: null,
    shippingDeliveryStatus: null,
    shippingDeliveredAt: null,
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: session.staffId,
    intakeOwnerId: session.staffId,
    createdAt: new Date().toISOString(),
    isDeleted: false,
    workflowTemplateId: template.id,
    workflowTemplateVersion: version.version,
    caseType: version.caseTypes[0],
    workflowSnapshot,
  };
  caseFixtures.push(newCase);
  return newCase;
}

export async function update(
  context: OrganizationContext,
  caseId: string,
  patch: CaseUpdate,
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Case> {
  assertIntakeOwnerUnchanged(patch);
  assertCreatedByUnchanged(patch);
  assertCaseNumberUnchanged(patch);

  if (dataAdapterMode === 'wix') {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: context.organizationId, patch }),
    });
    if (!response.ok) {
      // Mirrors create()'s own fix above: surface the route's specific,
      // already-safe-to-display error (e.g. the pickup-release validation
      // message below) instead of always discarding it for one generic
      // string.
      let message = `Case ${caseId} not found for this organization`;
      try {
        const errorBody = (await response.json()) as { error?: string };
        if (typeof errorBody?.error === 'string' && errorBody.error.trim() !== '') {
          message = errorBody.error;
        }
      } catch {
        // Response body wasn't valid JSON — fall back to the generic message.
      }
      throw new Error(message);
    }
    const body = (await response.json()) as { case: Case };
    return body.case;
  }

  if (patch.assignedStaffId) {
    await assertStaffProfileIsActiveAndInOrganization(context.organizationId, patch.assignedStaffId, 'mock');
  }

  const index = caseFixtures.findIndex(
    (c) => c.id === caseId && c.organizationId === context.organizationId,
  );
  if (index === -1) throw new Error(`Case ${caseId} not found for this organization`);
  // Staff-facing terminology (2026-09): see domain/cases/pickupRelease.ts's
  // own comment — mirrors the same check the Wix-mode PATCH route applies.
  assertValidPickupReleasePatch(caseFixtures[index], patch);
  // Task #15 (2026-09, future-historical-date validation): mirrors the
  // Wix-mode route's own check, only for a field this patch actually sets
  // (an untouched existing value is never re-validated by an unrelated
  // edit). Mock mode runs client-side, so the browser's own local "now" is
  // the correct reference clock here, same reasoning as create() above.
  const dateFieldChecks: Array<[unknown, (value: string) => string | null]> = [
    [patch.dateOfBirth, getDateOfBirthFutureError],
    [patch.dateOfDeath, getDateOfDeathFutureError],
    [patch.pickupReleasedAt, (value) => getFutureDateError(value, 'Released date')],
    [patch.shippingDateShipped, (value) => getFutureDateError(value, 'Date shipped')],
    [patch.shippingDeliveredAt, (value) => getFutureDateError(value, 'Delivered date')],
  ];
  for (const [value, check] of dateFieldChecks) {
    if (typeof value === 'string') {
      const error = check(value);
      if (error) throw new Error(error);
    }
  }
  // SOLIS-wide ALL-CAPS data standard (2026-09): mirrors
  // lib/wixCaseMapper.ts's validateAndPickCaseUpdate/applyCaseUpdateToWixData
  // normalization exactly, so dev/test behavior (DATA_ADAPTER=mock) never
  // diverges from production.
  const normalizedPatch = normalizeCaseTextFields(patch) as CaseUpdate;
  if (normalizedPatch.fieldValues !== undefined) {
    const snapshot = caseFixtures[index].workflowSnapshot;
    const normalizedFieldValues = normalizeCaseFieldValues(normalizedPatch.fieldValues, snapshot) ?? normalizedPatch.fieldValues;
    normalizedPatch.fieldValues = normalizedFieldValues;
    // Case Information sync fix (2026-09): mirrors
    // lib/wixCaseMapper.ts#applyCaseUpdateToWixData's identical fix exactly,
    // so DATA_ADAPTER=mock never diverges from DATA_ADAPTER=wix — see that
    // function's own comment for the full "why."
    if (snapshot) {
      const sync = deriveCaseFieldSyncFromFieldValues(snapshot.intake, normalizedFieldValues, new Set(Object.keys(patch)));
      Object.assign(normalizedPatch, sync);
    }
  }
  const updated = { ...caseFixtures[index], ...normalizedPatch };
  caseFixtures[index] = updated;

  // Task #6 (2026-09, checklist completion → workflow reconciliation).
  // Mirrors the Wix-mode PATCH route's identical fix exactly, so
  // DATA_ADAPTER=mock never diverges from DATA_ADAPTER=wix — see that
  // route's own comment for the full "why." Scoped to the original
  // (pre-normalization) patch's checklistState key, same as the route.
  let result: Case = updated;
  if (patch.checklistState) {
    try {
      const reconcileResult = await reconcileCaseWorkflow(context.organizationId, caseId, 'mock');
      if (reconcileResult.changed) {
        result = { ...result, rawStage: reconcileResult.rawStage };
      }
    } catch (error) {
      console.error('Failed to reconcile workflow after checklist update:', error instanceof Error ? error.message : error);
    }
  }
  return result;
}

export const casesService = { list, get, create, update, listPage, counts };
