import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canViewFinancialReports } from '@/services/authorizationPolicyService';
import { getGeneralLedgerDetail } from '@/services/financialReportsService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. General Ledger detail for one account — gated
    `accounting.report`. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const accountId = url.searchParams.get('accountId');
  if (!requestedOrganizationId || !accountId) {
    return NextResponse.json({ error: 'organizationId and accountId are required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canViewFinancialReports({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view financial reports for this organization.' }, { status: 403 });
  }

  const fromDate = url.searchParams.get('fromDate') ?? undefined;
  const toDate = url.searchParams.get('toDate') ?? undefined;

  try {
    const report = await getGeneralLedgerDetail(organizationId, accountId, dataAdapterMode, { fromDate, toDate });
    return NextResponse.json(report);
  } catch {
    return NextResponse.json({ error: 'Ledger account not found.' }, { status: 404 });
  }
}
