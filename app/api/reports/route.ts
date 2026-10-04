import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { hasPermission } from '@/services/permissionService';
import { canViewReports } from '@/services/authorizationPolicyService';
import { REPORT_REGISTRY, isReportVisibleForOrganization } from '@/domain/reporting/reportRegistry';
import { getForOrganization } from '@/services/organizationsService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Lists every
 * report definition the caller may view — filtered by each report's own
 * `permission` field, never a hardcoded list. Requires the base
 * `report.view` gate (same as the pre-existing Reports page) in addition
 * to each individual report's own permission.
 *
 * Manors cleanup phase: a report tagged `requiresModule` is additionally
 * hidden when the organization hasn't opted into that advanced module —
 * the same org-level visibility mechanism already hiding that module's own
 * nav links (components/layout/TopBar.tsx), so a report never outlives the
 * feature it reports on. Nothing is deleted: an organization that enables
 * the module later sees the report again automatically.
 *
 * Manors accounting/reports cleanup (2026-10): `isReportVisibleForOrganization`
 * also excludes an entire report category an organization has explicitly
 * hidden (domain/reporting/reportRegistry.ts's own `CATEGORY_HIDDEN_MODULE_KEY`)
 * — same reversible, organization-specific mechanism, opposite polarity.
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

  const organization = await getForOrganization(organizationId, dataAdapterMode);

  const visible = [];
  for (const report of REPORT_REGISTRY) {
    if (!isReportVisibleForOrganization(report, organization)) continue;
    if (await hasPermission(policyParams, dataAdapterMode, report.permission)) {
      visible.push(report);
    }
  }
  return NextResponse.json({ reports: visible });
}
