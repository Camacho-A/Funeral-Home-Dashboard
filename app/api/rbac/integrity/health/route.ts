import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { checkRbacHealth } from '@/services/rbacIntegrityService';

/**
 * Phase 38 (RBAC Grant Hygiene & Authorization Integrity). Read-only RBAC
 * authorization-health check for the Security page's health indicator. Gated
 * by `organization.manage` (administrator). Returns a coarse status + safe
 * counts only — never identity details or cross-tenant data. Mutates nothing.
 */
export async function GET(request: Request) {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageOrganization({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view authorization health.' }, { status: 403 });
  }

  const report = await checkRbacHealth(dataAdapterMode);
  return NextResponse.json({ health: report });
}
