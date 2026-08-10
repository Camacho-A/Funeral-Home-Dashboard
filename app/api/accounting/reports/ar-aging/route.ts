import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canViewFinancialReports } from '@/services/authorizationPolicyService';
import { getArAgingReport } from '@/services/financialReportsService';
import { getAccountByNumber } from '@/services/chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. AR Aging — cross-checks against the GL's own derived
    Accounts Receivable balance (see `getArAgingReport`'s own comment).
    Gated `accounting.report`. */
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

  const accountsReceivable = await getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, dataAdapterMode);
  if (!accountsReceivable) {
    return NextResponse.json({ error: 'Chart of accounts has not been seeded for this organization.' }, { status: 400 });
  }

  const asOfDate = url.searchParams.get('asOfDate') ?? undefined;
  const report = await getArAgingReport(organizationId, accountsReceivable.id, dataAdapterMode, asOfDate);
  return NextResponse.json(report);
}
