import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canViewReports, canManageDashboard } from '@/services/authorizationPolicyService';
import { list, create, ReportPresetServiceError } from '@/services/reportPresetService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Saved report
 * filter presets — own + shared, scoped to this organization.
 * `isShared: true` requires `dashboard.manage`.
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

  if (!(await canViewReports({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view reports for this organization.' }, { status: 403 });
  }

  const reportKey = url.searchParams.get('reportKey') ?? undefined;
  const presets = await list(organizationId, userId, { reportKey }, dataAdapterMode);
  return NextResponse.json({ presets });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, reportKey, name, filters, isShared } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof reportKey !== 'string' || reportKey.trim().length === 0) {
    return NextResponse.json({ error: 'reportKey is required.' }, { status: 400 });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }
  if (typeof filters !== 'string') {
    return NextResponse.json({ error: 'filters must be a serialized JSON string.' }, { status: 400 });
  }
  if (isShared !== undefined && typeof isShared !== 'boolean') {
    return NextResponse.json({ error: 'isShared must be a boolean.' }, { status: 400 });
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
    const preset = await create(
      organizationId,
      { reportKey, name, filters, isShared, ownerIdentityId: userId, canManageDashboard: canManage, idFactory: () => crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ preset });
  } catch (error) {
    if (error instanceof ReportPresetServiceError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
