import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canViewDocument } from '@/services/authorizationPolicyService';
import { list } from '@/services/documentService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 25 (Document Generation & Template Management). Lists a case's
 * documents (generated + uploaded, newest first). Unlike Phase 24's
 * `GET /api/cases/[caseId]/activity` (gated by `requireAuthorizedOrganization`
 * alone, since no separate case-activity permission exists), this route
 * *does* add an explicit `document.view` check — `document.view` already
 * existed as a permission distinct from `case.read` before this phase
 * (declared in Phase 22, dead until now), so reusing it here is a real,
 * pre-existing gate, not a newly-invented one with no real distinction
 * (see ADR-029 for the full reasoning, which explicitly does not inherit
 * ADR-028's "no real difference" argument).
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ documents: [], error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canViewDocument({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ documents: [], error: 'Not authorized to view documents for this case.' }, { status: 403 });
  }

  const documents = await list(organizationId, caseId, dataAdapterMode);
  return NextResponse.json({ documents });
}
