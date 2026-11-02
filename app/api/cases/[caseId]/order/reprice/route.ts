import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCaseOrder } from '@/services/authorizationPolicyService';
import { canPerformPricingAction } from '@/services/pricingAuthorization';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseOrderOperationErrorResponse } from '@/lib/caseOrderOperationResponses';
import { CaseOrderConflictError, CaseOrderCommitError, RepriceNotAllowedError, UnpricedCatalogItemError, repriceCaseOrder } from '@/services/pricingService';

/**
 * Price catalog (2026-11). POST /api/cases/[caseId]/order/reprice
 * `{ organizationId, expectedOrderId, confirm }` — the explicit, authorized
 * way to bring an existing order up to today's catalog prices
 * (pricingService.repriceCaseOrder). `confirm: false` previews the line
 * changes and writes nothing; `confirm: true` writes a new order version
 * (journaled, audited per line). Takes caseOrder.update AND the
 * organization's reprice permission (caseOrder.reprice); not offered to an
 * organization whose edits already re-price (the legacy model — Manors).
 * Stale `expectedOrderId` → 409 with nothing written.
 */
async function loadCase(caseId: string, organizationId: string): Promise<{ serviceTypeCode: string | null } | null> {
  if (getDataAdapterMode() === 'mock') {
    const found = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted);
    return found ? { serviceTypeCode: found.workflowSnapshot?.serviceTypeCode ?? null } : null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', {
    filter: { beaconCaseId: caseId, organizationId, isArchived: false },
    paging: { limit: 1 },
  });
  const found = mapWixCaseItem(response.dataItems[0]?.data);
  return found ? { serviceTypeCode: found.workflowSnapshot?.serviceTypeCode ?? null } : null;
}

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
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const b = body as { organizationId?: unknown; expectedOrderId?: unknown; confirm?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.expectedOrderId !== 'string' || b.expectedOrderId.trim() === '') {
    return NextResponse.json({ error: 'expectedOrderId is required: the id of the case order version being repriced.', reason: 'order_version_required' }, { status: 428 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  const caller = { identityId: userId, organizationId, roleKey: role };
  if (!(await canEditCaseOrder(caller, dataAdapterMode)) || !(await canPerformPricingAction(caller, dataAdapterMode, 'order.reprice'))) {
    return NextResponse.json({ error: 'You are not allowed to reprice a case order.', reason: 'reprice_not_permitted' }, { status: 403 });
  }
  const case_ = await loadCase(caseId, organizationId);
  if (!case_) return NextResponse.json({ error: 'Case not found for this organization.' }, { status: 404 });

  try {
    const result = await repriceCaseOrder(
      {
        organizationId,
        caseId,
        expectedOrderId: b.expectedOrderId,
        performedBy: userId,
        idFactory: () => crypto.randomUUID(),
        confirm: b.confirm === true,
        caseServiceTypeCode: case_.serviceTypeCode,
      },
      dataAdapterMode,
    );
    if (!result) return NextResponse.json({ error: 'This case has no case order yet.' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RepriceNotAllowedError) return NextResponse.json({ error: error.message, reason: 'reprice_not_offered' }, { status: 403 });
    if (error instanceof CaseOrderConflictError) {
      return NextResponse.json({ error: error.message, reason: 'order_conflict', order: error.current }, { status: 409 });
    }
    if (error instanceof UnpricedCatalogItemError) {
      return NextResponse.json({ error: error.message, unpricedItems: error.unpricedItems.map((i) => ({ serviceCode: i.serviceCode, displayName: i.displayName })) }, { status: 422 });
    }
    if (error instanceof CaseOrderCommitError) {
      return NextResponse.json({ error: error.message, needsRepair: !error.compensated }, { status: error.conflict ? 409 : 503 });
    }
    const operationResponse = caseOrderOperationErrorResponse(error);
    if (operationResponse) return operationResponse;
    throw error;
  }
}
