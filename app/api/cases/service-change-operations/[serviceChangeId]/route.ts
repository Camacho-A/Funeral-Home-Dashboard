import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canEditCase, canEditCaseOrder, isAdminTier } from '@/services/authorizationPolicyService';
import { isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';
import { changeCaseService } from '@/services/caseServiceChangeService';
import {
  compensateServiceChangeOperation,
  inspectServiceChangeOperation,
  isInterrupted,
  listServiceChangeOperations,
  recordServiceChangeJournal,
} from '@/services/serviceChangeJournal';

const ACTIONS = ['complete', 'compensate', 'close'] as const;
type RepairAction = (typeof ACTIONS)[number];

/**
 * Case concurrency (2026-10). POST — an administrator's EXPLICIT repair of
 * ONE interrupted service change of their own organization (see
 * services/serviceChangeJournal.ts and GET ../route.ts). Nothing is ever
 * repaired automatically, and never across organizations: the operation
 * is looked up only in the caller's organization's journal (another
 * organization's id is simply "not found").
 *
 * Body: { organizationId, action: 'complete' | 'compensate' | 'close', note? }
 *  - complete:   finish the change — the SAME changeCaseService a staff
 *                confirm runs, with the operation's own id as its
 *                idempotency key and its journaled selections. An order
 *                already in place is reused (no second order version, no
 *                second revenue entry); the case write is the usual
 *                revision-conditioned patch.
 *  - compensate: undo the order half (appends a restoring version and,
 *                when revenue was posted, a reversing entry — nothing is
 *                deleted). Refused when revenue posting is unknown.
 *  - close:      record that it needs nothing more (or was handled by
 *                hand), with an optional note.
 * Each is offered only when the CURRENT case and order make it safe
 * (inspection.allowedActions) and only once the operation is genuinely
 * interrupted — an in-flight change is never touched. Every outcome is
 * journaled (`resolved`) and audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ serviceChangeId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { serviceChangeId } = await params;
  const correlationId = crypto.randomUUID();

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (!ACTIONS.includes(b.action as RepairAction)) {
    return NextResponse.json({ error: `action must be one of: ${ACTIONS.join(', ')}.` }, { status: 400 });
  }
  const action = b.action as RepairAction;
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 1000) : null;

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  if (!isWorkflowByServiceType(organizationId)) {
    return NextResponse.json({ error: 'This organization does not select workflows by service type.' }, { status: 403 });
  }
  const adapter = getDataAdapterMode();
  const caller = { identityId: userId, organizationId, roleKey: role };
  const [admin, editCase, editOrder] = await Promise.all([isAdminTier(caller, adapter), canEditCase(caller, adapter), canEditCaseOrder(caller, adapter)]);
  if (!admin || !editCase || !editOrder) {
    return NextResponse.json({ error: 'Only an administrator can repair an interrupted service change.' }, { status: 403 });
  }

  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId };
  try {
    const op = (await listServiceChangeOperations(organizationId, adapter)).find((o) => o.serviceChangeId === serviceChangeId);
    if (!op) return NextResponse.json({ error: 'Service change operation not found.' }, { status: 404 });
    if (!isInterrupted(op)) {
      return NextResponse.json({ error: `This operation is not interrupted (status: ${op.status}); there is nothing to repair yet.`, status: op.status }, { status: 409 });
    }
    const inspection = await inspectServiceChangeOperation(op, adapter);
    if (!inspection.allowedActions.includes(action)) {
      return NextResponse.json({ error: `"${action}" is not safe for this operation now. ${inspection.summary}`, inspection }, { status: 409 });
    }

    const resolve = (resolution: 'completed' | 'compensated' | 'closed', extra: Record<string, unknown> = {}) =>
      recordServiceChangeJournal(ctx, { serviceChangeId, caseId: op.caseId, status: 'resolved', details: { resolution, note, ...extra } }, adapter);

    if (action === 'close') {
      await resolve('closed');
      return NextResponse.json({ resolved: true, resolution: 'closed', inspection });
    }

    if (action === 'compensate') {
      const outcome = await compensateServiceChangeOperation(op, ctx, adapter);
      if (outcome.status === 200) {
        await recordServiceChangeJournal(
          ctx,
          { serviceChangeId, caseId: op.caseId, status: 'compensated', details: { restoredOrderId: (outcome.body.restoredOrderId as string | null) ?? null, reason: 'compensated by an administrator' } },
          adapter,
        );
        await resolve('compensated');
      }
      return NextResponse.json(outcome.body, { status: outcome.status });
    }

    // complete
    const { toServiceTypeCode, expectedWorkflowTemplateId, selections } = op.details;
    if (!toServiceTypeCode || !expectedWorkflowTemplateId || !selections) {
      return NextResponse.json({ error: 'The journal does not hold enough to complete this change; close it after repairing by hand.' }, { status: 409 });
    }
    const outcome = await changeCaseService(
      {
        organizationId,
        caseId: op.caseId,
        userId,
        role,
        correlationId,
        serviceTypeCode: toServiceTypeCode,
        expectedWorkflowTemplateId,
        selections,
        confirm: true,
        idempotencyKey: serviceChangeId,
        // Phase 5A.1: an administrator repair, not a staff preview — pinned
        // to the fresh read changeCaseService makes (its case write is
        // conditional on that revision), never an unconditional overwrite.
        expectedRevision: 'repair',
      },
      adapter,
    );
    if (outcome.status === 200 && outcome.body.applied === true) await resolve('completed');
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
