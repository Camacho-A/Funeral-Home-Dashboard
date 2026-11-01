import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canEditCaseOrder, isAdminTier } from '@/services/authorizationPolicyService';
import { isOrderOperationInterrupted, listOrderOperations } from '@/services/orderOperationJournal';
import { inspectOrderOperation } from '@/services/orderOperationRepair';

/**
 * Interrupted order edits (2026-10, Phase 5A.2). GET — the READ-ONLY report
 * of case order changes that did not finish (services/orderOperationJournal.ts):
 * each with what its journal planned, how the order rows and the ledger
 * actually stand now, and which repair is safe. Writes nothing, ever.
 * `?all=1` lists every journaled operation, not just interrupted ones.
 *
 * Administrators only (admin-tier plus caseOrder.update, which a repair
 * needs). Scoped to the caller's own organization — the organizationId is
 * re-derived from the session, and only that organization's journal and
 * rows are read. Repairs are POST /api/cases/order-operations/[operationId].
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

  const adapter = getDataAdapterMode();
  const caller = { identityId: userId, organizationId, roleKey: role };
  const [admin, editOrder] = await Promise.all([isAdminTier(caller, adapter), canEditCaseOrder(caller, adapter)]);
  if (!admin || !editOrder) {
    return NextResponse.json({ error: 'Only an administrator can review interrupted case order changes.' }, { status: 403 });
  }

  try {
    const now = new Date();
    const all = url.searchParams.get('all') === '1';
    const operations = (await listOrderOperations(organizationId, adapter)).filter((op) => all || isOrderOperationInterrupted(op, now));
    const report = [];
    for (const op of operations) {
      const interrupted = isOrderOperationInterrupted(op, now);
      // The plan's audit entries stay out of the report (they are only
      // replayed by a repair); everything needed to decide is summarized.
      const { auditEntries, ...details } = op.details;
      report.push({ ...op, details: { ...details, auditEntryCount: auditEntries?.length ?? 0 }, interrupted, inspection: interrupted ? await inspectOrderOperation(op, adapter) : null });
    }
    return NextResponse.json({ operations: report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
