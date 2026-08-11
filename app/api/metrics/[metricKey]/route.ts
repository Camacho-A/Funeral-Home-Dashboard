import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { hasPermission } from '@/services/permissionService';
import { canViewReports } from '@/services/authorizationPolicyService';
import { getMetricDefinition } from '@/domain/reporting/metricRegistry';
import { getDataAdapterMode } from '@/lib/env';

import { runSingleMetric } from '@/services/reportingService';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). A single metric
 * value — backs drill-down cards and ad hoc dashboard widgets that don't
 * need a whole report. Delegates to the exact same metric runner
 * `reportingService.runReport` uses; never a second calculation path.
 */
export async function GET(request: Request, { params }: { params: Promise<{ metricKey: string }> }) {
  const { metricKey } = await params;
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const definition = getMetricDefinition(metricKey);
  if (!definition) {
    return NextResponse.json({ error: `Unknown metric key "${metricKey}".` }, { status: 404 });
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
    return NextResponse.json({ error: `Not authorized to view the "${metricKey}" metric.` }, { status: 403 });
  }

  const filters = {
    fromDate: url.searchParams.get('fromDate') ?? undefined,
    toDate: url.searchParams.get('toDate') ?? undefined,
    staffProfileId: url.searchParams.get('staffProfileId') ?? undefined,
    stage: url.searchParams.get('stage') ?? undefined,
    resourceId: url.searchParams.get('resourceId') ?? undefined,
    locationId: url.searchParams.get('locationId') ?? undefined,
    identityId: userId,
  };

  const value = await runSingleMetric(organizationId, metricKey, filters, dataAdapterMode);
  return NextResponse.json({ metricKey, displayName: definition.displayName, value });
}
