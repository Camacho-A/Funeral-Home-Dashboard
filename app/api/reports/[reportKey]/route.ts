import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { hasPermission } from '@/services/permissionService';
import { canViewReports } from '@/services/authorizationPolicyService';
import { getReportDefinition } from '@/domain/reporting/reportRegistry';
import { runReport, ReportRunnerError } from '@/services/reportingService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Runs one report
 * — this route never computes a metric or reimplements a financial
 * report itself, it only forwards query-string filters to
 * `reportingService.runReport` and returns whatever it computed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ reportKey: string }> }) {
  const { reportKey } = await params;
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const definition = getReportDefinition(reportKey);
  if (!definition) {
    return NextResponse.json({ error: `Unknown report key "${reportKey}".` }, { status: 404 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  const policyParams = { identityId: userId, organizationId, roleKey: role };

  if (!(await canViewReports(policyParams, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view reports for this organization.' }, { status: 403 });
  }
  if (!(await hasPermission(policyParams, dataAdapterMode, definition.permission))) {
    return NextResponse.json({ error: `Not authorized to view the "${reportKey}" report.` }, { status: 403 });
  }

  const filters = {
    fromDate: url.searchParams.get('fromDate') ?? undefined,
    toDate: url.searchParams.get('toDate') ?? undefined,
    staffProfileId: url.searchParams.get('staffProfileId') ?? undefined,
    stage: url.searchParams.get('stage') ?? undefined,
    resourceId: url.searchParams.get('resourceId') ?? undefined,
    locationId: url.searchParams.get('locationId') ?? undefined,
    accountId: url.searchParams.get('accountId') ?? undefined,
  };

  try {
    const result = await runReport(organizationId, reportKey, filters, dataAdapterMode);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReportRunnerError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
