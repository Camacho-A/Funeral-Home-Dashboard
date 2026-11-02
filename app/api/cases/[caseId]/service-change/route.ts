import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canEditCase, canEditCaseOrder } from '@/services/authorizationPolicyService';
import { isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';
import { changeCaseService } from '@/services/caseServiceChangeService';
import { CASE_REVISION_REQUIRED_MESSAGE, CASE_REVISION_REQUIRED_REASON, parseExpectedRevisionValue } from '@/domain/cases/caseRevisionConflict';

/**
 * Consistent service changes (2026-10). Changes a case's service type —
 * its workflow AND its case order — in ONE request, so the two can never
 * be left disagreeing. See services/caseServiceChangeService.ts for the
 * prepare → commit → compensate semantics (Wix has no multi-document
 * transactions; this is honest about what that means).
 *
 * Body: { organizationId, serviceTypeCode, expectedWorkflowTemplateId,
 *         selections, confirm, expectedOrderId?, idempotencyKey? }.
 *  - `selections`: the order selections exactly as PATCH
 *    /api/cases/[caseId]/order takes them; their serviceTypeCode must be
 *    `serviceTypeCode`.
 *  - confirm !== true: a DRY RUN — the workflow preview plus what the
 *    order will become; writes nothing. An unpriced selection or a draft
 *    workflow is refused here already (422).
 *  - confirm === true: requires `idempotencyKey` (one per confirmed
 *    preview; send the same key on a retry), `expectedOrderId` (the
 *    active order id the preview showed, or null when the case had none)
 *    and `expectedRevision` (Phase 5A.1: the `caseRevision` the preview
 *    returned — 428 when missing, 409 `revision_conflict` when the case
 *    changed since; nothing written either way).
 *
 * Only for organizations with `features.workflowByServiceType` (403 for
 * everyone else — Manors' order editing stays on PATCH .../order,
 * unchanged). Requires BOTH permissions the two halves need: `case.update`
 * (canEditCase, as POST .../workflow) and `caseOrder.update`
 * (canEditCaseOrder, as PATCH .../order). Scoped to the caller's own
 * organization: another organization's case is "not found" (404).
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const correlationId = crypto.randomUUID();
  const { caseId } = await params;

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  if (!isWorkflowByServiceType(organizationId)) {
    return NextResponse.json({ error: 'This organization does not select workflows by service type.' }, { status: 403 });
  }

  const adapter = getDataAdapterMode();
  const caller = { identityId: userId, organizationId, roleKey: role };
  if (!(await canEditCase(caller, adapter)) || !(await canEditCaseOrder(caller, adapter))) {
    return NextResponse.json({ error: 'Not authorized to change this case’s services.' }, { status: 403 });
  }

  if (typeof b.serviceTypeCode !== 'string' || b.serviceTypeCode.trim() === '') {
    return NextResponse.json({ error: 'serviceTypeCode is required.' }, { status: 400 });
  }
  if (typeof b.expectedWorkflowTemplateId !== 'string' || b.expectedWorkflowTemplateId === '') {
    return NextResponse.json({ error: 'expectedWorkflowTemplateId is required.' }, { status: 400 });
  }
  if (!b.selections || typeof b.selections !== 'object' || Array.isArray(b.selections)) {
    return NextResponse.json({ error: 'selections is required.' }, { status: 400 });
  }
  const confirm = b.confirm === true;
  if (b.expectedOrderId !== undefined && b.expectedOrderId !== null && typeof b.expectedOrderId !== 'string') {
    return NextResponse.json({ error: 'expectedOrderId must be a string or null.' }, { status: 400 });
  }
  if (confirm) {
    if (b.expectedOrderId === undefined) {
      return NextResponse.json({ error: 'expectedOrderId is required to confirm a service change.' }, { status: 400 });
    }
    if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.trim() === '' || b.idempotencyKey.length > 200) {
      return NextResponse.json({ error: 'idempotencyKey is required to confirm a service change.' }, { status: 400 });
    }
  }
  const expectedRevision = parseExpectedRevisionValue(b.expectedRevision);
  if (expectedRevision === 'invalid') {
    return NextResponse.json({ error: 'expectedRevision must be a non-negative integer.' }, { status: 400 });
  }
  if (confirm && expectedRevision === undefined) {
    return NextResponse.json({ error: CASE_REVISION_REQUIRED_MESSAGE, reason: CASE_REVISION_REQUIRED_REASON }, { status: 428 });
  }

  try {
    const outcome = await changeCaseService(
      {
        organizationId,
        caseId,
        userId,
        role,
        correlationId,
        serviceTypeCode: b.serviceTypeCode.trim(),
        expectedWorkflowTemplateId: b.expectedWorkflowTemplateId,
        ...(b.expectedOrderId !== undefined ? { expectedOrderId: b.expectedOrderId as string | null } : {}),
        selections: b.selections as Record<string, unknown>,
        confirm,
        idempotencyKey: typeof b.idempotencyKey === 'string' ? b.idempotencyKey.trim() : null,
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      },
      adapter,
    );
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (error) {
    // Only a read before any write can land here — nothing was changed.
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
