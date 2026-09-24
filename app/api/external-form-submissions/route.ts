import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadCases } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';

/** Manors Jotform integration (case-first architecture, 2026-09). The
    "Unmatched Forms" queue — never a case-creation surface, only ever
    lists submissions whose linkage couldn't be resolved at receipt time,
    for manual linking (see .../[submissionId]/link/route.ts). Gated by
    `case.read`, matching the same tier as viewing any other case-adjacent
    data. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadCases({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view unmatched forms for this organization.' }, { status: 403 });
  }

  const submissions = await externalFormSubmissionService.listUnmatched(resolvedOrganizationId, dataAdapterMode);
  return NextResponse.json({ submissions });
}
