import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canViewReports, canManageDashboard } from '@/services/authorizationPolicyService';
import { remove, ReportPresetServiceError } from '@/services/reportPresetService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Removes a saved
 * report preset — the caller's own, or a shared one if they hold
 * `dashboard.manage`. Never another owner's private preset.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ presetId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { presetId } = await params;
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

  const canManage = await canManageDashboard(policyParams, dataAdapterMode);
  try {
    await remove(organizationId, presetId, { identityId: userId, canManageDashboard: canManage }, dataAdapterMode);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ReportPresetServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 403 });
    }
    throw error;
  }
}
