import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canEditCase, canEditCaseOrder, isAdminTier } from '@/services/authorizationPolicyService';
import { isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';
import { inspectServiceChangeOperation, isInterrupted, listServiceChangeOperations } from '@/services/serviceChangeJournal';

/**
 * Case concurrency (2026-10). GET — the READ-ONLY reconciliation report of
 * coordinated service changes that did not finish (see
 * services/serviceChangeJournal.ts): each with what its journal planned,
 * how the case and order actually stand now, and which repair is safe.
 * Writes nothing, ever. `?all=1` lists every journaled operation, not just
 * the interrupted ones.
 *
 * Administrators only (admin-tier, plus the case.update and
 * caseOrder.update a repair needs). Scoped to the caller's own
 * organization — the organizationId is re-derived from the session, and
 * only that organization's journal is read. Only for organizations that
 * change service through POST .../service-change (403 otherwise).
 *
 * Repairs are POST /api/cases/service-change-operations/[serviceChangeId].
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  if (!isWorkflowByServiceType(organizationId)) {
    return NextResponse.json({ error: 'This organization does not select workflows by service type.' }, { status: 403 });
  }
  const adapter = getDataAdapterMode();
  const caller = { identityId: userId, organizationId, roleKey: role };
  const [admin, editCase, editOrder] = await Promise.all([isAdminTier(caller, adapter), canEditCase(caller, adapter), canEditCaseOrder(caller, adapter)]);
  if (!admin || !editCase || !editOrder) {
    return NextResponse.json({ error: 'Only an administrator can review interrupted service changes.' }, { status: 403 });
  }

  try {
    const now = new Date();
    const all = url.searchParams.get('all') === '1';
    const operations = (await listServiceChangeOperations(organizationId, adapter)).filter((op) => all || isInterrupted(op, now));
    const report = [];
    for (const op of operations) {
      const interrupted = isInterrupted(op, now);
      report.push({ ...op, interrupted, inspection: interrupted ? await inspectServiceChangeOperation(op, adapter) : null });
    }
    return NextResponse.json({ operations: report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
