import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canEditCaseOrder, isAdminTier } from '@/services/authorizationPolicyService';
import { isOrderOperationInterrupted, listOrderOperations } from '@/services/orderOperationJournal';
import { closeOrderOperation, completeOrderOperation, rollBackOrderOperation } from '@/services/orderOperationRepair';

const ACTIONS = ['complete', 'roll_back', 'close'] as const;
type RepairAction = (typeof ACTIONS)[number];

/**
 * Interrupted order edits (2026-10, Phase 5A.2). POST — an administrator's
 * EXPLICIT repair of ONE interrupted case order change of their own
 * organization (services/orderOperationRepair.ts). Nothing is repaired
 * automatically and never across organizations: the operation is looked
 * up only in the caller's organization's journal (another organization's
 * id is simply "not found").
 *
 * Body: { organizationId, action: 'complete' | 'roll_back' | 'close', note? }
 * Each action is offered only when the CURRENT order rows and ledger make
 * it safe (inspection.allowedActions) and only once the operation is
 * genuinely interrupted — an in-flight change is never touched. Every
 * outcome is journaled (`resolved`, with the administrator) and a resolved
 * operation is never repaired twice.
 */
export async function POST(request: Request, { params }: { params: Promise<{ operationId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { operationId } = await params;

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

  const adapter = getDataAdapterMode();
  const caller = { identityId: userId, organizationId, roleKey: role };
  const [admin, editOrder] = await Promise.all([isAdminTier(caller, adapter), canEditCaseOrder(caller, adapter)]);
  if (!admin || !editOrder) {
    return NextResponse.json({ error: 'Only an administrator can repair an interrupted case order change.' }, { status: 403 });
  }

  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const op = (await listOrderOperations(organizationId, adapter)).find((o) => o.operationId === operationId);
    if (!op) return NextResponse.json({ error: 'Case order operation not found.' }, { status: 404 });
    if (!isOrderOperationInterrupted(op)) {
      return NextResponse.json({ error: `This operation is not interrupted (status: ${op.status}); there is nothing to repair.`, status: op.status }, { status: 409 });
    }
    const outcome =
      action === 'complete'
        ? await completeOrderOperation(op, ctx, note, adapter)
        : action === 'roll_back'
          ? await rollBackOrderOperation(op, ctx, note, adapter)
          : await closeOrderOperation(op, ctx, note, adapter);
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
