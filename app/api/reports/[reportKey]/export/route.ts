import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { hasPermission } from '@/services/permissionService';
import { canViewReports, canExportReports } from '@/services/authorizationPolicyService';
import { getReportDefinition } from '@/domain/reporting/reportRegistry';
import { exportReportCsv } from '@/services/reportExportService';
import { ReportRunnerError } from '@/services/reportingService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). CSV export for
 * one report — requires `report.export` *in addition to* the report's
 * own view permission, never as a substitute for it (mirrors
 * `audit.export`'s own precedent). Uses the exact same filters as the
 * report itself would — never a wider, unfiltered query.
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
  if (!(await canExportReports(policyParams, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to export reports for this organization.' }, { status: 403 });
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
    const csv = await exportReportCsv(organizationId, reportKey, filters, dataAdapterMode);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${reportKey}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof ReportRunnerError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
