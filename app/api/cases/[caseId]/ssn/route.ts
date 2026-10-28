import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { CaseSsnError, correctCaseSsn } from '@/services/caseSsnService';
import { parseSsnCorrectionReason } from '@/domain/cases/caseSsn';

/**
 * Case SSN correction (2026-10). The SSN is locked on the case once
 * captured from its intake form; this is the only way to change it.
 *
 *   POST { organizationId, ssn, reason } → 200 { ssnOnFile } (last four only)
 *
 * Administrators only (organization.manage), with a reason recorded in the
 * case activity. The number is never echoed, logged, or included in an
 * error.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = (body ?? {}) as { organizationId?: unknown; ssn?: unknown; reason?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const mode = getDataAdapterMode();
  if (!(await canManageOrganization({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Only an administrator can correct the Social Security number.' }, { status: 403 });
  }

  if (typeof b.ssn !== 'string') return NextResponse.json({ error: 'A Social Security number has 9 digits.' }, { status: 400 });
  const reason = parseSsnCorrectionReason(b.reason);
  if (typeof reason !== 'string') return NextResponse.json({ error: reason.error }, { status: 400 });

  try {
    const ssnOnFile = await correctCaseSsn(
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      caseId,
      { ssn: b.ssn.slice(0, 20), reason },
      mode,
    );
    return NextResponse.json({ ssnOnFile });
  } catch (error) {
    if (error instanceof CaseSsnError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Correcting the Social Security number failed:', error instanceof Error ? error.name : 'unknown error');
    return NextResponse.json({ error: 'The Social Security number could not be corrected. Please try again.' }, { status: 500 });
  }
}
