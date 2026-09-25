import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canEditCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { reconcileCaseWorkflow } from '@/services/workflowReconciliationService';

/**
 * Manors workflow reconciliation (2026-09) — Administrator-safe repair for
 * a case that was imported/updated before this checkpoint's reconciliation
 * hooks existed (or whose reconciliation otherwise never ran). Does NOT
 * re-import anything, create another case, allocate a case number, touch
 * `caseSequences`, or duplicate any payment/submission/document — it only
 * ever calls the same `reconcileCaseWorkflow` every other event-driven
 * call site already uses, so this is never a second code path with its
 * own logic to drift out of sync. Idempotent: calling this on an
 * already-correct case is a no-op (`changed: false`).
 */
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
  const b = body as { organizationId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  const dataAdapterMode = getDataAdapterMode();
  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to recalculate this case.' }, { status: 403 });
  }

  const result = await reconcileCaseWorkflow(organizationId, caseId, dataAdapterMode);
  return NextResponse.json(result);
}
