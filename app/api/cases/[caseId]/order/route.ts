import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import {
  getActiveCaseOrder,
  listLineItemsForOrder,
  listAuditEntriesForCase,
  createCaseOrder,
  recalculateOrder,
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
 */

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
  | { ok: true; organizationId: string; selections: unknown; performedBy: string }
  | { ok: false; response: NextResponse }
> {
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

  if (!isPlainObject(body.selections)) {
    return { ok: false, response: NextResponse.json({ error: 'selections is required.' }, { status: 400 }) };
  }
  // Same trust model as Case's createdBy/intakeOwnerId (see app/api/cases/route.ts's
  // own comment): accepted from the client's trusted useSession() value,
  // not yet re-derived from a server-side session lookup — a documented,
  // pre-existing limitation, not new to this phase.
  if (typeof body.performedBy !== 'string' || body.performedBy.trim() === '') {
    return { ok: false, response: NextResponse.json({ error: 'performedBy is required.' }, { status: 400 }) };
  }

  return {
    ok: true,
    organizationId: authResult.context.organizationId,
    selections: body.selections,
    performedBy: body.performedBy,
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
  const order = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  const lineItems = order ? await listLineItemsForOrder(organizationId, order.id, dataAdapterMode) : [];
  const auditEntries = await listAuditEntriesForCase(organizationId, caseId, dataAdapterMode);

  return NextResponse.json({ order, lineItems, auditEntries });
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
  const existing = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (existing) {
    return NextResponse.json(
      { error: 'This case already has a case order. Use PATCH to edit its services.' },
      { status: 409 },
    );
  }

  const { order, lineItems, auditEntry } = await createCaseOrder(
    { organizationId, caseId, selections, performedBy, idFactory: () => crypto.randomUUID() },
    dataAdapterMode,
  );
  return NextResponse.json({ order, lineItems, auditEntries: [auditEntry] }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const parsed = await parseAuthorizedBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, selections, performedBy } = parsed;

  if (!(await caseExistsForOrganization(caseId, organizationId))) {
    return NextResponse.json({ error: 'Case not found for this organization.' }, { status: 404 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const result = await recalculateOrder(
    { organizationId, caseId, selections, performedBy, idFactory: () => crypto.randomUUID() },
    dataAdapterMode,
  );
  if (!result) {
    return NextResponse.json({ error: 'This case has no case order yet — create one first.' }, { status: 404 });
  }

  return NextResponse.json({ order: result.order, lineItems: result.lineItems, auditEntries: result.auditEntries });
}
