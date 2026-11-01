import { NextResponse } from 'next/server';
import { runAfterResponse } from '@/lib/afterResponse';
import { regenerateBillingDocuments } from '@/services/automaticBillingDocuments';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadCaseOrder, canEditCaseOrder } from '@/services/authorizationPolicyService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseOrderOperationErrorResponse } from '@/lib/caseOrderOperationResponses';
import {
  getCaseOrderState,
  listLineItemsForOrder,
  listAuditEntriesForCase,
  createCaseOrder,
  recalculateOrder,
  UnpricedCatalogItemError,
  CaseOrderConflictError,
  CaseOrderCommitError,
  CaseOrderInterruptedError,
} from '@/services/pricingService';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). One case's
 * itemized pricing record — see docs/adr/ADR-023-case-order-pricing-engine.md.
 *
 * GET returns the current active CaseOrder (null if the case predates
 * this phase, or somehow has none yet) plus its line items and this
 * case's full audit history. POST creates a case's first CaseOrder
 * (called once, immediately after case creation — see
 * components/modals/NewCaseModal.tsx). PATCH edits an existing active
 * CaseOrder (Edit Services on Case Detail) — always producing a new
 * version, never mutating history (services/pricingService.ts's
 * recalculateOrder).
 *
 * Every write always re-fetches the organization's catalog and
 * recalculates totals server-side from the submitted *selections* —
 * never a submitted total/amount/balanceDue. See
 * domain/pricing/calculateOrder.ts's own "never trust browser totals"
 * comment.
 *
 * 2026-10: POST/PATCH answer 422 — persisting nothing — when the selected
 * items include one whose catalog price isn't set (UnpricedCatalogItemError);
 * the message tells staff to set the price in Settings › Services & Pricing.
 *
 * Non-destructive order versioning (2026-10, docs/ORDER_VERSIONING.md).
 * PATCH requires `expectedOrderId` — the id of the order version staff were
 * editing. A missing one is refused (428, nothing written): an edit that
 * isn't tied to a version is never treated as permission to replace
 * whatever is active now. If another edit made a newer version first, 409
 * `order_conflict` carries the current order and its lines, nothing
 * written. The superseded version is never rewritten — only its status and
 * supersede metadata change, by a conditional field-scoped patch.
 */

/** 409 reason when the edited order version is no longer the active one. */
const ORDER_CONFLICT_REASON = 'order_conflict';
/** 428 reason when a staff edit names no order version. */
const ORDER_VERSION_REQUIRED_REASON = 'order_version_required';

async function orderConflictResponse(error: CaseOrderConflictError, organizationId: string): Promise<NextResponse> {
  const lineItems = error.current ? await listLineItemsForOrder(organizationId, error.current.id, getDataAdapterMode()).catch(() => []) : [];
  return NextResponse.json({ error: error.message, reason: ORDER_CONFLICT_REASON, order: error.current, lineItems }, { status: 409 });
}

/** A commit that failed part-way: a conflict is 409; anything else 503,
    flagged `needsRepair` when the partial write could not be undone. */
function commitErrorResponse(error: CaseOrderCommitError): NextResponse {
  if (error.conflict) return NextResponse.json({ error: error.message, reason: ORDER_CONFLICT_REASON, needsRepair: !error.compensated }, { status: 409 });
  return NextResponse.json({ error: error.message, needsRepair: !error.compensated }, { status: 503 });
}

function unpricedResponse(error: UnpricedCatalogItemError): NextResponse {
  return NextResponse.json(
    { error: error.message, unpricedItems: error.unpricedItems.map((item) => ({ serviceCode: item.serviceCode, displayName: item.displayName })) },
    { status: 422 },
  );
}

async function caseExistsForOrganization(caseId: string, organizationId: string): Promise<boolean> {
  if (getDataAdapterMode() === 'mock') {
    return caseFixtures.some((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted);
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', {
    filter: { beaconCaseId: caseId, organizationId, isArchived: false },
    paging: { limit: 1 },
  });
  return mapWixCaseItem(response.dataItems[0]?.data) !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function parseAuthorizedBody(
  request: Request,
): Promise<
  | { ok: true; organizationId: string; selections: unknown; performedBy: string; expectedOrderId: unknown }
  | { ok: false; response: NextResponse }
> {
  // Manors go-live fix (2026-09): `performedBy` used to be trusted directly
  // from the client body (the same class of gap Phase 30 already closed
  // for Case's createdBy/intakeOwnerId) — this was the one route the
  // session-identity audit found still doing it. It's now always the
  // caller's own real, server-resolved identity id (never client input),
  // matching services/merchandise's own already-correct use of this same
  // field.
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return { ok: false, response: csrfResponse };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) };
  }
  if (!isPlainObject(body)) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }) };
  }

  if (typeof body.organizationId !== 'string') {
    return { ok: false, response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  }
  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return { ok: false, response: authResult.response };

  // Manors launch-prep — additional case charges: adding/editing a case's
  // services and add-ons is a write action (`caseOrder.update`), a
  // pre-existing gap this closes — previously any org member with case
  // access could create/edit a case order regardless of role.
  const dataAdapterMode = getDataAdapterMode();
  if (
    !(await canEditCaseOrder(
      { identityId: authResult.context.userId, organizationId: authResult.context.organizationId, roleKey: authResult.context.role },
      dataAdapterMode,
    ))
  ) {
    return { ok: false, response: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) };
  }

  if (!isPlainObject(body.selections)) {
    return { ok: false, response: NextResponse.json({ error: 'selections is required.' }, { status: 400 }) };
  }

  return {
    ok: true,
    organizationId: authResult.context.organizationId,
    selections: body.selections,
    performedBy: authResult.context.userId,
    expectedOrderId: body.expectedOrderId,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const dataAdapterMode = getDataAdapterMode();
  // Manors launch-prep — additional case charges: viewing/editing a case's
  // operational services and add-ons is gated on the broader caseOrder.read
  // (held by every case-working role), not payment.read — that stays
  // reserved for the case's financial total/balance/history specifically
  // (see GET /api/cases/[caseId]/payments and CaseOrderCard.tsx).
  if (!(await canReadCaseOrder({ identityId: authResult.context.userId, organizationId, roleKey: authResult.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  // Interrupted order edits (Phase 5A.2): the EFFECTIVE order — while an
  // unfinished change holds the case it is the version the case is still
  // billed for (never "no order yet", which would invite a fresh order
  // replacing its billing lines) — plus the interruption, so the card can
  // say the order is locked pending repair.
  const { effective: order, interruption } = await getCaseOrderState(organizationId, caseId, dataAdapterMode);
  const lineItems = order ? await listLineItemsForOrder(organizationId, order.id, dataAdapterMode) : [];
  const auditEntries = await listAuditEntriesForCase(organizationId, caseId, dataAdapterMode);

  return NextResponse.json({ order, lineItems, auditEntries, interruption });
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const parsed = await parseAuthorizedBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, selections, performedBy } = parsed;

  if (!(await caseExistsForOrganization(caseId, organizationId))) {
    return NextResponse.json({ error: 'Case not found for this organization.' }, { status: 404 });
  }

  const dataAdapterMode = getDataAdapterMode();
  // An unfinished change (Phase 5A.2) is not "no order": refused, never a
  // fresh order that would replace the billing lines and re-post revenue.
  const { effective: existing, interruption } = await getCaseOrderState(organizationId, caseId, dataAdapterMode);
  if (interruption) {
    return caseOrderOperationErrorResponse(new CaseOrderInterruptedError(interruption))!;
  }
  if (existing) {
    return NextResponse.json(
      { error: 'This case already has a case order. Use PATCH to edit its services.' },
      { status: 409 },
    );
  }

  let created: Awaited<ReturnType<typeof createCaseOrder>>;
  try {
    created = await createCaseOrder(
      { organizationId, caseId, selections, performedBy, idFactory: () => crypto.randomUUID() },
      dataAdapterMode,
    );
  } catch (error) {
    if (error instanceof UnpricedCatalogItemError) return unpricedResponse(error);
    if (error instanceof CaseOrderCommitError) return commitErrorResponse(error);
    const operationResponse = caseOrderOperationErrorResponse(error);
    if (operationResponse) return operationResponse;
    throw error;
  }
  const { order, lineItems, auditEntry } = created;
  scheduleBillingDocuments(organizationId, caseId, performedBy, dataAdapterMode);
  return NextResponse.json({ order, lineItems, auditEntries: [auditEntry] }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const parsed = await parseAuthorizedBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, selections, performedBy, expectedOrderId } = parsed;

  if (expectedOrderId === undefined || expectedOrderId === null) {
    return NextResponse.json(
      { error: 'expectedOrderId is required: the id of the case order version being edited.', reason: ORDER_VERSION_REQUIRED_REASON },
      { status: 428 },
    );
  }
  if (typeof expectedOrderId !== 'string' || expectedOrderId.trim() === '') {
    return NextResponse.json({ error: 'expectedOrderId must be a case order id.' }, { status: 400 });
  }

  if (!(await caseExistsForOrganization(caseId, organizationId))) {
    return NextResponse.json({ error: 'Case not found for this organization.' }, { status: 404 });
  }

  const dataAdapterMode = getDataAdapterMode();
  let result: Awaited<ReturnType<typeof recalculateOrder>>;
  try {
    result = await recalculateOrder(
      { organizationId, caseId, selections, performedBy, idFactory: () => crypto.randomUUID(), expectedOrderId },
      dataAdapterMode,
    );
  } catch (error) {
    if (error instanceof UnpricedCatalogItemError) return unpricedResponse(error);
    if (error instanceof CaseOrderConflictError) return orderConflictResponse(error, organizationId);
    if (error instanceof CaseOrderCommitError) return commitErrorResponse(error);
    const operationResponse = caseOrderOperationErrorResponse(error);
    if (operationResponse) return operationResponse;
    throw error;
  }
  if (!result) {
    return NextResponse.json({ error: 'This case has no case order yet — create one first.' }, { status: 404 });
  }

  // Only when the order actually changed: an unchanged save writes no audit entry.
  if (result.auditEntries.length > 0) scheduleBillingDocuments(organizationId, caseId, performedBy, dataAdapterMode);
  return NextResponse.json({ order: result.order, lineItems: result.lineItems, auditEntries: result.auditEntries });
}

/** Automatic Statement/Receipt (2026-10) — after the response, never able
    to fail this request. See services/automaticBillingDocuments.ts. */
function scheduleBillingDocuments(organizationId: string, caseId: string, performedBy: string, dataAdapterMode: ReturnType<typeof getDataAdapterMode>) {
  runAfterResponse(`billing documents for case ${caseId}`, () =>
    regenerateBillingDocuments(
      { caseId, trigger: 'order_saved' },
      { organizationId, actorIdentityId: performedBy, actorMembershipId: null, actorRoleKey: null, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    ),
  );
}
