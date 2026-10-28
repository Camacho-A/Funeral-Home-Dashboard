import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { backfillCaseSsns, CaseSsnError } from '@/services/caseSsnService';

export const maxDuration = 300;

/**
 * Case SSN — one-time fill for existing cases (2026-10).
 *
 *   POST { organizationId, dryRun: true }  → what would be saved; nothing changes
 *   POST { organizationId, dryRun: false } → saves and locks; each save is in
 *                                            that case's activity
 *
 * Administrators only. The report lists case numbers and outcomes — never a
 * digit of any SSN.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = (body ?? {}) as { organizationId?: unknown; dryRun?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.dryRun !== 'boolean') return NextResponse.json({ error: 'dryRun must be true or false.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const mode = getDataAdapterMode();
  if (!(await canManageOrganization({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Only an administrator can fill Social Security numbers.' }, { status: 403 });
  }
  try {
    const report = await backfillCaseSsns(
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      { dryRun: b.dryRun },
      mode,
    );
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof CaseSsnError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('The Social Security number fill failed:', error instanceof Error ? error.name : 'unknown error');
    return NextResponse.json({ error: 'The fill could not be completed. Please try again.' }, { status: 500 });
  }
}
