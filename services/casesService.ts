import type { OrganizationContext } from '../types/organization';
import { isSlaTrackingEnabled } from '../domain/sla/slaSettings';
import { isChecklistAutomationEnabled, staffChecklistCompletionUpdate } from '../domain/workflow/checklistAutomation';
import { historicalChecklistKeys } from '../domain/workflow/earlierStages';
import { adminOnlyChecklistChanges, CREMATORY_SENT_ITEMS_ADMIN_ONLY_MESSAGE } from '../domain/crematory/sentChecklistItems';
import { caseRevision } from '../lib/wixCaseMapper';
import {
  CASE_REVISION_CONFLICT_REASON,
  CASE_REVISION_REQUIRED_MESSAGE,
  CASE_REVISION_REQUIRED_REASON,
  CaseRevisionConflictError,
  CaseRevisionRequiredError,
} from '../domain/cases/caseRevisionConflict';
import { mapKeysStillAtBase, type CaseMapBaseValues } from '../domain/cases/caseMergeBase';
import type { Case, CaseUpdate, NewCaseInput } from '../types/case';
import type { Session } from '../types/session';
import type { WorkflowTemplate } from '../types/workflowTemplate';
import type { DataAdapterMode } from '../lib/env';
import { assertIntakeOwnerUnchanged, assertCreatedByUnchanged } from '../domain/cases/intakeOwnership';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '../domain/workflow/snapshot';
import { formatCaseNumber, parseCaseNumber, assertCaseNumberUnchanged, resolveCaseNumberPrefix } from '../domain/cases/caseNumber';
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
import { touchesWorkflowCompletion } from '../domain/cases/workflowCompletion';
import { completionTransition } from '../domain/cases/completionEligibility';
import { writeMockCase } from './caseWriteService';
import { archivedCaseWriteRefusal } from '../domain/cases/archivedCaseWrites';
import { findInvalidChecklistStatePatchEntries } from '../domain/workflow/checklistItemKey';
import { STAGES, rawStagesForDisplayStage } from '../domain/cases/stages';
import { canonicalDisplayStagesForPresentedLabel } from '../domain/organization/workflowStagePresentation';
import {
  isWorkflowByServiceType,
  selectWorkflowTemplate,
  WorkflowSelectionError,
} from '../domain/workflow/selectWorkflowTemplate';
import {
  caseIsInOrganizationStage,
  findOrganizationStage,
  resolveOrganizationStages,
} from '../domain/workflow/organizationStages';
import { calculateOrderTotals, normalizeSelections, serviceTypeItems } from '../domain/pricing/calculateOrder';
import {
  applyWorkflowChangeToCase,
  planCaseWorkflowChange,
  type WorkflowChangePreview,
} from '../domain/workflow/planCaseWorkflowChange';
import { workflowTemplateFixtures } from './__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from './__mocks__/pricingFixtures';
import { pricingClient, buildSelectionsBody } from './pricingClient';
import type { ServiceCatalogItem } from '../types/serviceCatalog';
import type { CaseOrder, CaseOrderLineItem, CustomLineItemSelection, ServiceSelections } from '../types/caseOrder';
import type { ServiceChangeOrderPreview } from './caseServiceChangeService';
import {
  clampCaseListPageSize,
  compareCasesForListSort,
  encodeCaseCursor,
  matchesCaseSearch,
  validateCaseCursor,
  type CaseListScope,
} from '../lib/casePagination';

export type CaseFilters = {
  searchQuery?: string;
  /**
   * Archived-case visibility (2026-10). Omitted means the ACTIVE list, so
   * every existing caller — case lists, counts, operational metrics — is
   * unchanged and keeps excluding archived cases.
   *
   * 'all' exists for HISTORICAL surfaces that must keep describing a case
   * after it is filed away. The calendar is the first: archiving a case
   * used to blank its own past events to "Case: Not available / Deceased:
   * Not available", because the lookup those events are enriched from
   * silently dropped the case. An archived case is a historical record,
   * not a deleted one.
   */
  scope?: CaseListScope;
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
  /** Archived Cases (2026-10). Omitted returns the ACTIVE list, so every
      existing caller is unchanged. See CaseListScope for why 'all'
      exists. */
  scope?: CaseListScope;
};

function listPageMock(context: OrganizationContext, filters: CaseListPageFilters): CaseListPage {
  const searchQuery = filters.searchQuery ?? '';
  const scope = filters.scope ?? 'active';
  const stage = filters.stage ?? null;
  // Service-specific workflows (2026-10): an organization whose cases run
  // on several workflow templates filters by (template, raw stage) pairs
  // — mirrors app/api/cases/route.ts's identical branch.
  if (isWorkflowByServiceType(context.organizationId)) {
    return listPageMockByTemplate(context, filters);
  }
  // Manors intake-stage combination (2026-10): resolved against the
  // organization, so a user-facing label covering more than one canonical
  // display stage ("Intake & JotForm" = canonical 0 and 1) expands to
  // every raw stage it covers. Mirrors app/api/cases/route.ts exactly, so
  // this local mock path and the real route can never disagree about what
  // a stage filter means. The historical labels still resolve to just
  // their own stage. See domain/organization/workflowStagePresentation.ts.
  const canonicalDisplayStages = stage
    ? canonicalDisplayStagesForPresentedLabel(context.organizationId, stage, STAGES)
    : null;
  const rawStages = canonicalDisplayStages
    ? canonicalDisplayStages.flatMap((displayStage) => rawStagesForDisplayStage(displayStage))
    : null;
  if (stage && canonicalDisplayStages === null) {
    // An unrecognized stage never silently falls back to "All Cases" —
    // matches app/api/cases/route.ts's own 400 behavior in spirit (the
    // caller here has no HTTP status to return, so an empty page is the
    // closest local equivalent to "there is nothing to show").
    return { cases: [], hasMore: false, nextCursor: null };
  }

  const eligible = caseFixtures.filter(
    (c) => c.organizationId === context.organizationId && (scope === 'all' || c.isDeleted === (scope === 'archived')) && (rawStages === null || rawStages.includes(c.rawStage)),
  );
  const searched = eligible.filter((c) => matchesCaseSearch(c, searchQuery));
  const sorted = [...searched].sort(compareCasesForListSort);

  let offset = 0;
  if (filters.cursor) {
    const validation = validateCaseCursor(filters.cursor, { organizationId: context.organizationId, searchQuery, stage, scope, kind: 'mock' });
    if (!validation.ok || validation.payload.kind !== 'mock') {
      return { cases: [], hasMore: false, nextCursor: null };
    }
    offset = validation.payload.offset;
  }

  const pageSize = clampCaseListPageSize(filters.limit ?? null);
  const page = sorted.slice(offset, offset + pageSize);
  const hasMore = offset + page.length < sorted.length;
  const nextCursor = hasMore
    ? encodeCaseCursor({ v: 1, kind: 'mock', organizationId: context.organizationId, searchQuery, stage, scope, offset: offset + page.length })
    : null;

  return { cases: page, hasMore, nextCursor };
}

function listPageMockByTemplate(context: OrganizationContext, filters: CaseListPageFilters): CaseListPage {
  const searchQuery = filters.searchQuery ?? '';
  const scope = filters.scope ?? 'active';
  const stage = filters.stage ?? null;
  const model = resolveOrganizationStages(
    context.organizationId,
    workflowTemplateFixtures.filter((t) => t.organizationId === context.organizationId),
  );
  const stageEntry = stage ? findOrganizationStage(model, stage) : null;
  if (stage && !stageEntry) return { cases: [], hasMore: false, nextCursor: null };

  const eligible = caseFixtures.filter(
    (c) =>
      c.organizationId === context.organizationId &&
      (scope === 'all' || c.isDeleted === (scope === 'archived')) &&
      (stageEntry === null || caseIsInOrganizationStage(stageEntry, c)),
  );
  const sorted = eligible.filter((c) => matchesCaseSearch(c, searchQuery)).sort(compareCasesForListSort);

  let offset = 0;
  if (filters.cursor) {
    const validation = validateCaseCursor(filters.cursor, { organizationId: context.organizationId, searchQuery, stage, scope, kind: 'mock' });
    if (!validation.ok || validation.payload.kind !== 'mock') return { cases: [], hasMore: false, nextCursor: null };
    offset = validation.payload.offset;
  }
  const pageSize = clampCaseListPageSize(filters.limit ?? null);
  const page = sorted.slice(offset, offset + pageSize);
  const hasMore = offset + page.length < sorted.length;
  const nextCursor = hasMore
    ? encodeCaseCursor({ v: 1, kind: 'mock', organizationId: context.organizationId, searchQuery, stage, scope, offset: offset + page.length })
    : null;
  return { cases: page, hasMore, nextCursor };
}

/** Service-specific workflows (2026-10). Per-stage counts for an
    organization whose cases run on several templates, keyed by the
    organization's stage labels (domain/workflow/organizationStages.ts).
    Shared by the local mock path below and app/api/cases/counts's mock
    branch, so the two can't disagree. */
export function countCasesByOrganizationStage(organizationId: string, eligible: Case[]): Record<string, number> {
  const model = resolveOrganizationStages(
    organizationId,
    workflowTemplateFixtures.filter((t) => t.organizationId === organizationId),
  );
  const byStage: Record<string, number> = {};
  for (const stage of model.stages) {
    byStage[stage.label] = eligible.filter((c) => caseIsInOrganizationStage(stage, c)).length;
  }
  return byStage;
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
  if (filters.scope && filters.scope !== 'active') params.set('scope', filters.scope);

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
      (c) => c.organizationId === context.organizationId && !c.isDeleted && matchesCaseSearch(c, searchQuery),
    );
    if (isWorkflowByServiceType(context.organizationId)) {
      return { total: eligible.length, byStage: countCasesByOrganizationStage(context.organizationId, eligible) };
    }
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
  // Organization-specific prefix (2026-10): e.g. Gus Camacho → M, Manors → B.
  const prefix = resolveCaseNumberPrefix(null, { organizationId });
  const highestSequence = caseFixtures
    .filter((c) => c.organizationId === organizationId)
    .reduce((max, c) => {
      const parsed = parseCaseNumber(c.caseNumber, prefix);
      return parsed && parsed.year === year && parsed.sequence > max ? parsed.sequence : max;
    }, 0);
  return formatCaseNumber(year, highestSequence + 1, prefix);
}

function listMock(context: OrganizationContext, filters: CaseFilters): Case[] {
  return caseFixtures.filter(
    (c) =>
      c.organizationId === context.organizationId &&
      (filters.scope === 'all' || c.isDeleted === (filters.scope === 'archived')) &&
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
  if (filters.scope && filters.scope !== 'active') params.set('scope', filters.scope);

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
    // Archived cases are readable (2026-10) — mirrors the Wix GET route's
    // own change exactly; see its comment for the full "why". Archiving
    // files a case away, it does not hide it from the person who goes
    // looking for it. Editing is refused separately, on write.
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === context.organizationId) ?? null;
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
        serviceTypeCode: input.serviceTypeCode ?? undefined,
        createdBy: session.staffId,
        intakeOwnerId: session.staffId,
        returnMethod: input.returnMethod,
        // Service-specific workflows (2026-10): only ever sent for an
        // organization that selects workflows by service type, so every
        // other organization's request body is exactly what it was.
        ...(isWorkflowByServiceType(context.organizationId) ? { serviceTypeCode: input.serviceTypeCode ?? null } : {}),
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

  let selectedTemplate = template;
  let version = latestTemplateVersion(template);
  let serviceTypeCode: string | undefined;
  // Service-specific workflows (2026-10): mirrors POST /api/cases — the
  // selection is re-run here against the organization's own templates and
  // active service types. The caller's `template` (fetched from
  // /api/workflow-templates, so it reflects approvals made there) replaces
  // the local fixture copy of the same id; it can only ever be one of this
  // organization's templates.
  if (isWorkflowByServiceType(context.organizationId)) {
    const serviceTypes = serviceTypeItems(serviceCatalogFixtures.filter((item) => item.organizationId === context.organizationId));
    const localTemplates = workflowTemplateFixtures.filter((t) => t.organizationId === context.organizationId && t.id !== template.id);
    const selection = selectWorkflowTemplate(
      template.organizationId === context.organizationId ? [template, ...localTemplates] : localTemplates,
      context.organizationId,
      input.serviceTypeCode,
      {
        activeServiceTypeCodes: serviceTypes.map((item) => item.serviceCode),
        serviceDisplayName: (code) => serviceTypes.find((item) => item.serviceCode === code)?.displayName,
      },
    );
    if (!selection.ok) throw new WorkflowSelectionError(selection.reason, selection.message);
    selectedTemplate = selection.template;
    version = selection.version;
    serviceTypeCode = selection.serviceTypeCode ?? undefined;
  }
  const creationYear = new Date().getFullYear();
  const workflowSnapshot = buildCaseWorkflowSnapshot(selectedTemplate, version, serviceTypeCode);
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
  const createdAt = new Date().toISOString();
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
    createdAt,
    // SLA tracking (2026-10): mirrors the Wix-mode create route.
    stageEnteredAt: createdAt,
    ...(isSlaTrackingEnabled(context.organizationId)
      ? { slaEvents: { case_received: { at: createdAt, recordedAt: createdAt, recordedBy: null, source: 'automatic' as const } } }
      : {}),
    isDeleted: false,
    workflowTemplateId: selectedTemplate.id,
    workflowTemplateVersion: version.version,
    caseType: version.caseTypes[0],
    workflowSnapshot,
  };
  caseFixtures.push(newCase);
  return newCase;
}

/**
 * Case concurrency (2026-10, docs/CASE_CONCURRENCY.md). `expectedRevision`
 * is the revision of the case the edit was made against — REQUIRED: a save
 * without one is refused (CaseRevisionRequiredError; HTTP 428 in Wix mode)
 * and nothing is written. A save against a revision the case has moved past
 * throws CaseRevisionConflictError carrying the current case — unless it
 * only changes checklist/fieldValues/VA keys that still hold `baseValues`.
 */
export type CaseUpdateOptions = {
  expectedRevision?: number;
  baseValues?: CaseMapBaseValues;
  /** The staff member making the edit, for checklist completion attribution. */
  actorId?: string | null;
  /** Mock mode only (2026-10): the caller is an administrator, who alone may
      change Workflow 3's two "sent to crematory" items by hand. With real
      data the server decides (app/api/cases/[caseId]/route.ts). */
  isAdministrator?: boolean;
};

/**
 * Service-specific workflows (2026-10). Previews (confirm: false) or
 * applies (confirm: true) a service-type change's workflow change — see
 * app/api/cases/[caseId]/workflow/route.ts, which wix mode calls. Mock
 * mode runs the identical pure planner (domain/workflow/planCaseWorkflowChange.ts)
 * against the local fixtures, mirroring how update() works locally.
 */
/** `expectedRevision` (Phase 5A.1) — required with confirm: the
    `caseRevision` the preview returned (hooks/useCaseWorkflowChange.ts
    fills it in). */
export type CaseWorkflowChangeInput = { serviceTypeCode: string; expectedWorkflowTemplateId: string; confirm: boolean; expectedRevision?: number };
/** Mock mode only: the organization's templates as served by
    /api/workflow-templates (so approvals made there are honored). */
export type CaseWorkflowChangeOptions = { templates?: WorkflowTemplate[] };
export type CaseWorkflowChangeResult = { applied: boolean; preview: WorkflowChangePreview; case?: Case | null; caseRevision?: number };

export async function changeWorkflow(
  context: OrganizationContext,
  caseId: string,
  input: CaseWorkflowChangeInput,
  session: Session,
  dataAdapterMode: DataAdapterMode = 'mock',
  options: CaseWorkflowChangeOptions = {},
): Promise<CaseWorkflowChangeResult> {
  if (dataAdapterMode === 'wix') {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: context.organizationId, ...input }),
    });
    const body = (await response.json().catch(() => null)) as (CaseWorkflowChangeResult & { error?: string; reason?: string; case?: Case | null }) | null;
    if (response.status === 409 && body?.reason === CASE_REVISION_CONFLICT_REASON) {
      throw new CaseRevisionConflictError(body.case ?? null, body.error);
    }
    if (response.status === 428 && body?.reason === CASE_REVISION_REQUIRED_REASON) throw new CaseRevisionRequiredError(body.error);
    if (!response.ok || !body) throw new Error(body?.error ?? 'Failed to change the case workflow.');
    return body;
  }

  if (!isWorkflowByServiceType(context.organizationId)) {
    throw new Error('This organization does not select workflows by service type.');
  }
  const index = caseFixtures.findIndex((c) => c.id === caseId && c.organizationId === context.organizationId);
  if (index === -1) throw new Error(`Case ${caseId} not found for this organization`);
  const existing = caseFixtures[index];
  if (existing.isDeleted) throw new Error('Archived cases are read-only. Restore the case before changing its service.');

  const serviceTypes = serviceTypeItems(serviceCatalogFixtures.filter((item) => item.organizationId === context.organizationId));
  const plan = planCaseWorkflowChange(
    existing,
    (options.templates ?? workflowTemplateFixtures).filter((t) => t.organizationId === context.organizationId),
    { serviceTypeCode: input.serviceTypeCode, expectedWorkflowTemplateId: input.expectedWorkflowTemplateId },
    {
      activeServiceTypeCodes: serviceTypes.map((item) => item.serviceCode),
      serviceDisplayName: (code) => serviceTypes.find((item) => item.serviceCode === code)?.displayName,
    },
  );
  if (!plan.ok) throw new Error(plan.message);
  if (!input.confirm || plan.write === null) return { applied: false, preview: plan.preview, caseRevision: caseRevision(existing) };
  // Phase 5A.1: mirrors the route — a confirm is pinned to its preview's revision.
  if (input.expectedRevision === undefined) throw new CaseRevisionRequiredError();
  if (caseRevision(existing) !== input.expectedRevision) throw new CaseRevisionConflictError(existing);

  const updated: Case = {
    ...applyWorkflowChangeToCase(existing, plan.write, {
      changedAt: new Date().toISOString(),
      changedByUserId: session.staffId ?? session.displayName,
    }),
    revision: caseRevision(existing) + 1,
  };
  caseFixtures[index] = updated;
  return { applied: true, preview: plan.preview, case: updated };
}

/**
 * Consistent service changes (2026-10). Previews (confirm: false) or
 * applies (confirm: true) a service-type change as ONE coordinated
 * operation — the case's workflow and its case order together — see
 * app/api/cases/[caseId]/service-change/route.ts and
 * services/caseServiceChangeService.ts, which wix mode calls.
 *
 * Mock mode mirrors changeWorkflow(): the workflow is planned against the
 * local fixtures, an unpriced selection is refused before anything is
 * written, and on confirm the order is written FIRST (through the order
 * route, which owns mock orders) and only then the workflow — the same
 * order-then-case sequence as the server, without its compensation
 * (mock data is development-only).
 */
export type CaseServiceChangeInput = {
  serviceTypeCode: string;
  expectedWorkflowTemplateId: string;
  /** The active order the modal was opened with (null = none yet). */
  expectedOrderId: string | null;
  selections: ServiceSelections;
  customItems?: CustomLineItemSelection[];
  confirm: boolean;
  /** Required with confirm; reuse the same key when retrying. */
  idempotencyKey?: string;
  /** Phase 5A.1 — required with confirm: the `caseRevision` the preview
      returned (hooks/useCaseServiceChange.ts fills it in). */
  expectedRevision?: number;
};
export type CaseServiceChangeOptions = { templates?: WorkflowTemplate[]; catalog?: ServiceCatalogItem[] };
export type CaseServiceChangeResult = {
  applied: boolean;
  replayed?: boolean;
  preview?: WorkflowChangePreview;
  /** Preview: what the order becomes. Applied: the active order. */
  order?: ServiceChangeOrderPreview | CaseOrder | null;
  lineItems?: CaseOrderLineItem[];
  case?: Case | null;
  /** Preview: the case revision it was computed against — send it back as
      `expectedRevision` to confirm. */
  caseRevision?: number;
};

/** A refused or failed service change. `needsRepair`: the server could
    not undo a partial change and recorded it in Activity. */
export class ServiceChangeError extends Error {
  readonly status: number;
  readonly needsRepair: boolean;
  constructor(message: string, status: number, needsRepair: boolean) {
    super(message);
    this.name = 'ServiceChangeError';
    this.status = status;
    this.needsRepair = needsRepair;
  }
}

export async function changeService(
  context: OrganizationContext,
  caseId: string,
  input: CaseServiceChangeInput,
  session: Session,
  dataAdapterMode: DataAdapterMode = 'mock',
  options: CaseServiceChangeOptions = {},
): Promise<CaseServiceChangeResult> {
  const selections = buildSelectionsBody({ selections: input.selections, customItems: input.customItems });
  if (dataAdapterMode === 'wix') {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/service-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: context.organizationId,
        serviceTypeCode: input.serviceTypeCode,
        expectedWorkflowTemplateId: input.expectedWorkflowTemplateId,
        expectedOrderId: input.expectedOrderId,
        selections,
        confirm: input.confirm,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
      }),
    });
    const body = (await response.json().catch(() => null)) as (CaseServiceChangeResult & { error?: string; needsRepair?: boolean }) | null;
    if (!response.ok || !body) {
      throw new ServiceChangeError(body?.error ?? 'Failed to change the service.', response.status, body?.needsRepair === true);
    }
    return body;
  }

  // Mock: plan + validate everything before any write.
  if (!isWorkflowByServiceType(context.organizationId)) {
    throw new ServiceChangeError('This organization does not select workflows by service type.', 403, false);
  }
  const index = caseFixtures.findIndex((c) => c.id === caseId && c.organizationId === context.organizationId);
  if (index === -1) throw new ServiceChangeError(`Case ${caseId} not found for this organization`, 404, false);
  const existing = caseFixtures[index];
  if (existing.isDeleted) throw new ServiceChangeError('Archived cases are read-only. Restore the case before changing its service.', 409, false);

  const catalog = (options.catalog ?? serviceCatalogFixtures).filter((item) => item.organizationId === context.organizationId);
  const serviceTypes = serviceTypeItems(catalog);
  const plan = planCaseWorkflowChange(
    existing,
    (options.templates ?? workflowTemplateFixtures).filter((t) => t.organizationId === context.organizationId),
    { serviceTypeCode: input.serviceTypeCode, expectedWorkflowTemplateId: input.expectedWorkflowTemplateId },
    {
      activeServiceTypeCodes: serviceTypes.map((item) => item.serviceCode),
      serviceDisplayName: (code) => serviceTypes.find((item) => item.serviceCode === code)?.displayName,
    },
  );
  if (!plan.ok) throw new ServiceChangeError(plan.message, plan.status, false);
  const unpriced = calculateOrderTotals(catalog, normalizeSelections(input.selections as unknown as Record<string, unknown>)).unpricedItems;
  if (unpriced.length > 0) {
    const names = unpriced.map((item) => `"${item.displayName}"`).join(', ');
    throw new ServiceChangeError(`No price is set for ${names}. An administrator must set it in Settings › Price Catalog first.`, 422, false);
  }
  if (!input.confirm) return { applied: false, preview: plan.preview, caseRevision: caseRevision(existing) };
  // Phase 5A.1: mirrors the route — a confirm is pinned to its preview's revision.
  if (input.expectedRevision === undefined) throw new ServiceChangeError(CASE_REVISION_REQUIRED_MESSAGE, 428, false);
  if (caseRevision(existing) !== input.expectedRevision) {
    throw new ServiceChangeError('This case was changed by someone else since the preview was shown. Nothing was changed — reload the case and try again.', 409, false);
  }

  const orderInput = { selections: input.selections, customItems: input.customItems };
  const orderResult = input.expectedOrderId
    ? await pricingClient.editCaseOrder(context, caseId, { ...orderInput, expectedOrderId: input.expectedOrderId })
    : await pricingClient.createCaseOrder(context, caseId, orderInput);
  if (plan.write === null) return { applied: true, preview: plan.preview, order: orderResult.order, case: existing };

  const history = existing.workflowHistory ?? [];
  const applied = applyWorkflowChangeToCase(existing, plan.write, {
    changedAt: new Date().toISOString(),
    changedByUserId: session.staffId ?? session.displayName,
  });
  const updated: Case = {
    ...applied,
    revision: caseRevision(existing) + 1,
    ...(input.idempotencyKey
      ? {
          lastServiceChangeId: input.idempotencyKey,
          workflowHistory: [...history, { ...applied.workflowHistory![history.length], serviceChangeId: input.idempotencyKey }],
        }
      : {}),
  };
  caseFixtures[index] = updated;
  return { applied: true, preview: plan.preview, order: orderResult.order, lineItems: orderResult.lineItems, case: updated };
}

export async function update(
  context: OrganizationContext,
  caseId: string,
  patch: CaseUpdate,
  dataAdapterMode: DataAdapterMode = 'mock',
  options: CaseUpdateOptions = {},
): Promise<Case> {
  assertIntakeOwnerUnchanged(patch);
  assertCreatedByUnchanged(patch);
  assertCaseNumberUnchanged(patch);

  if (dataAdapterMode === 'wix') {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: context.organizationId,
        patch,
        expectedRevision: options.expectedRevision,
        ...(options.baseValues ? { baseValues: options.baseValues } : {}),
      }),
    });
    if (response.status === 409 || response.status === 428) {
      const errorBody = (await response.json().catch(() => null)) as { case?: Case | null; error?: string; reason?: string } | null;
      if (errorBody?.reason === CASE_REVISION_CONFLICT_REASON) throw new CaseRevisionConflictError(errorBody.case ?? null);
      if (errorBody?.reason === CASE_REVISION_REQUIRED_REASON) throw new CaseRevisionRequiredError();
      throw new Error(errorBody?.error?.trim() ? errorBody.error : `Case ${caseId} could not be saved.`);
    }
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

  if (options.expectedRevision === undefined) throw new CaseRevisionRequiredError();

  if (patch.assignedStaffId) {
    await assertStaffProfileIsActiveAndInOrganization(context.organizationId, patch.assignedStaffId, 'mock');
  }

  const index = caseFixtures.findIndex(
    (c) => c.id === caseId && c.organizationId === context.organizationId,
  );
  if (index === -1) throw new Error(`Case ${caseId} not found for this organization`);
  // Same revision rule as the Wix PATCH route (mock mode never diverges).
  if (
    caseRevision(caseFixtures[index]) !== options.expectedRevision &&
    !mapKeysStillAtBase(caseFixtures[index], patch as Record<string, unknown>, options.baseValues)
  ) {
    throw new CaseRevisionConflictError(caseFixtures[index]);
  }
  // Archived cases are read-only (2026-10): mirrors the Wix PATCH route's
  // identical guard, so DATA_ADAPTER=mock never diverges. Both read the
  // same shared rule — see domain/cases/archivedCaseWrites.ts.
  const archivedRefusal = archivedCaseWriteRefusal(caseFixtures[index], patch);
  if (archivedRefusal) throw new Error(archivedRefusal);
  // Staff-facing terminology (2026-09): see domain/cases/pickupRelease.ts's
  // own comment — mirrors the same check the Wix-mode PATCH route applies.
  assertValidPickupReleasePatch(caseFixtures[index], patch);
  // B2026-035 hardening (2026-10): mirrors the Wix-mode PATCH route's
  // identical check exactly — see
  // domain/workflow/checklistItemKey.ts#findInvalidChecklistStatePatchEntries.
  if (patch.checklistState) {
    const invalidEntries = findInvalidChecklistStatePatchEntries(
      caseFixtures[index].checklistState,
      patch.checklistState,
      caseFixtures[index].workflowSnapshot,
      {
        organizationId: context.organizationId,
        isMedicalExaminerCase:
          patch.isMedicalExaminerCase !== undefined
            ? patch.isMedicalExaminerCase === true
            : caseFixtures[index].isMedicalExaminerCase === true,
      },
    );
    if (invalidEntries.length > 0) {
      throw new Error(`Invalid checklist state: ${invalidEntries.map((e) => `"${e.key}" (${e.reason})`).join('; ')}`);
    }
    // Send to Crematory (2026-10): mirrors the Wix PATCH route's rule.
    if (options.isAdministrator !== true && adminOnlyChecklistChanges(caseFixtures[index], patch.checklistState).length > 0) {
      throw new Error(CREMATORY_SENT_ITEMS_ADMIN_ONLY_MESSAGE);
    }
  }
  // Task #15 (2026-09, future-historical-date validation): mirrors the
  // Wix-mode route's own check, only for a field this patch actually sets
  // (an untouched existing value is never re-validated by an unrelated
  // edit). Mock mode runs client-side, so the browser's own local "now" is
  // the correct reference clock here, same reasoning as create() above.
  const dateFieldChecks: Array<[unknown, (value: string) => string | null]> = [
    [patch.dateOfBirth, getDateOfBirthFutureError],
    [patch.dateOfDeath, getDateOfDeathFutureError],
    [patch.pickupReleasedAt, (value) => getFutureDateError(value, 'Released date')],
    [patch.dateOfCremation, (value) => getFutureDateError(value, 'Date of cremation')],
    [patch.cremainsReceivedAt, (value) => getFutureDateError(value, 'Date received')],
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
  // Map fields merge per key and every write bumps the revision — the same
  // semantics as lib/wixCaseMapper.ts#buildCaseFieldPatch.
  const existingCase = caseFixtures[index];
  // Checklist completion attribution (2026-10): mirrors the Wix-mode
  // PATCH route — every item this edit changes is recorded as staff's.
  const staffCompletions =
    normalizedPatch.checklistState && isChecklistAutomationEnabled(existingCase.organizationId)
      ? staffChecklistCompletionUpdate(existingCase, normalizedPatch.checklistState, options.actorId ?? null, new Date().toISOString(), {
          historicalKeys: historicalChecklistKeys(existingCase, normalizedPatch.checklistState),
        })
      : null;
  const updated: Case = {
    ...existingCase,
    ...normalizedPatch,
    ...(normalizedPatch.checklistState ? { checklistState: { ...existingCase.checklistState, ...normalizedPatch.checklistState } } : {}),
    ...(staffCompletions ? { checklistCompletions: { ...existingCase.checklistCompletions, ...staffCompletions } } : {}),
    ...(normalizedPatch.rawStage !== undefined && normalizedPatch.rawStage !== existingCase.rawStage ? { stageEnteredAt: new Date().toISOString() } : {}),
    ...(normalizedPatch.fieldValues ? { fieldValues: { ...existingCase.fieldValues, ...normalizedPatch.fieldValues } } : {}),
    ...(normalizedPatch.vaStepsState ? { vaStepsState: { ...existingCase.vaStepsState, ...normalizedPatch.vaStepsState } } : {}),
    revision: caseRevision(existingCase) + 1,
  };
  caseFixtures[index] = updated;

  // Task #6 (2026-09, checklist completion → workflow reconciliation).
  // Mirrors the Wix-mode PATCH route's identical fix exactly, so
  // DATA_ADAPTER=mock never diverges from DATA_ADAPTER=wix — see that
  // route's own comment for the full "why." Both read the SAME shared
  // trigger list, so the two can no longer drift apart. Scoped to the
  // original (pre-normalization) patch, same as the route.
  let result: Case = updated;
  if (touchesWorkflowCompletion(patch)) {
    try {
      const reconcileResult = await reconcileCaseWorkflow(context.organizationId, caseId, 'mock');
      if (reconcileResult.changed) {
        result = reconcileResult.case_ ?? { ...result, rawStage: reconcileResult.rawStage };
      }
    } catch (error) {
      console.error('Failed to reconcile workflow after checklist update:', error instanceof Error ? error.message : error);
    }
  }

  // Service-specific completion (2026-10): mirrors the Wix PATCH route —
  // the completion transition is judged AFTER reconciliation against the
  // case's own frozen policy, and archives only when that policy archives
  // on completion. (Mock mode records no activity events for case edits,
  // here or elsewhere in this client-side path; the Wix route records
  // case.completed / case.archived.)
  if (!existingCase.isDeleted && completionTransition(existingCase, result).archive) {
    result = writeMockCase(context.organizationId, caseId, (latest) => ({ ...latest, isDeleted: true, archivedAt: new Date().toISOString() })) ?? result;
  }
  return result;
}

export const casesService = { list, get, create, update, listPage, counts, changeWorkflow, changeService };
