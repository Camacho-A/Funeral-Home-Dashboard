import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadFinancials } from '@/services/authorizationPolicyService';
import { getStatementLinesForImport } from '@/services/bankingService';
import { getForOrganization } from '@/services/organizationsService';
import { isModuleEnabled } from '@/domain/organization/moduleVisibility';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. Every `BankStatementLine` belonging to one import — gated
    `accounting.view`. */
export async function GET(request: Request, { params }: { params: Promise<{ importId: string }> }) {
  const { importId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const organization = await getForOrganization(organizationId, dataAdapterMode);
  if (!isModuleEnabled(organization, 'reconciliation')) {
    return NextResponse.json({ error: 'Reconciliation is not enabled for this organization.' }, { status: 403 });
  }

  if (!(await canReadFinancials({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view financial data for this organization.' }, { status: 403 });
  }

  const lines = await getStatementLinesForImport(organizationId, importId, dataAdapterMode);
  return NextResponse.json({ lines });
}
