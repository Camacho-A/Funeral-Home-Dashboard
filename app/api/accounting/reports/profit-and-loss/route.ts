import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canViewFinancialReports } from '@/services/authorizationPolicyService';
import { getProfitAndLoss } from '@/services/financialReportsService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. Profit & Loss — gated `accounting.report`. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
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
  const report = await getProfitAndLoss(organizationId, dataAdapterMode, { fromDate, toDate });
  return NextResponse.json(report);
}
