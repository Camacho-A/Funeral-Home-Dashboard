import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { hasPermission } from '@/services/permissionService';
import { canViewReports } from '@/services/authorizationPolicyService';
import { REPORT_REGISTRY } from '@/domain/reporting/reportRegistry';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Lists every
 * report definition the caller may view — filtered by each report's own
 * `permission` field, never a hardcoded list. Requires the base
 * `report.view` gate (same as the pre-existing Reports page) in addition
 * to each individual report's own permission.
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

  if (!(await canViewReports(policyParams, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view reports for this organization.' }, { status: 403 });
  }

  const visible = [];
  for (const report of REPORT_REGISTRY) {
    if (await hasPermission(policyParams, dataAdapterMode, report.permission)) {
      visible.push(report);
    }
  }
  return NextResponse.json({ reports: visible });
}
