import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canViewOperationalReports, canViewFinancialReports } from '@/services/authorizationPolicyService';
import { getDashboard } from '@/services/dashboardService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The Executive
 * Dashboard's 4 sections — `today` needs no permission (every
 * authenticated member reads their own unread-notification count);
 * `operations`/`financial`/`attention` are computed by
 * `dashboardService.getDashboard` only for the permissions the caller
 * actually holds, never computed-then-hidden.
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
  const dataAdapterMode = getDataAdapterMode();
  const policyParams = { identityId: userId, organizationId, roleKey: role };

  const [canViewOperational, canViewFinancial] = await Promise.all([
    canViewOperationalReports(policyParams, dataAdapterMode),
    canViewFinancialReports(policyParams, dataAdapterMode),
  ]);

  const dashboard = await getDashboard(organizationId, { identityId: userId, permissions: { canViewOperational, canViewFinancial } }, dataAdapterMode);
  return NextResponse.json(dashboard);
}
