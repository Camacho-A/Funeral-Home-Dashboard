import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canCreateCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import * as externalFormConfigService from '@/services/externalFormConfigService';

/**
 * Manors Jotform integration — historical case creation (2026-09). A
 * minimal, case-independent listing of this organization's enabled
 * `ExternalFormConfig` rows (id/label/audience only) — needed because the
 * historical-case-creation flow has no existing case yet to scope
 * `GET /api/cases/[caseId]/forms` by. Gated by `case.create` since this
 * feature is its only consumer today.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ configs: [], error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canCreateCase({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ configs: [], error: 'Not authorized to create cases for this organization.' }, { status: 403 });
  }

  const configs = await externalFormConfigService.listForOrganization(resolvedOrganizationId, dataAdapterMode);
  return NextResponse.json({ configs: configs.map((c) => ({ id: c.id, label: c.label, audience: c.audience })) });
}
