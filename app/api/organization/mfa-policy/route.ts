import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { getOrganization, updateOrganization } from '@/services/organizationProvisioningService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 40 (MFA & Account Security). Read/set the organization's require-MFA
 * policy. Gated by `organization.manage` (an administrator setting). RBAC and
 * MFA state stay separate — this only flips a policy flag; it never grants a
 * permission. Never applies to Family Portal authentication.
 */
export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const auth = await requireAuthorizedOrganization(organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canManageOrganization({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const org = await getOrganization(auth.context.organizationId, mode);
  return NextResponse.json({ requireMfa: org?.requireMfa === true });
}

export async function PATCH(request: Request) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; requireMfa?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.requireMfa !== 'boolean') return NextResponse.json({ error: 'requireMfa must be a boolean.' }, { status: 400 });

  const auth = await requireAuthorizedOrganization(b.organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canManageOrganization({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const updated = await updateOrganization(auth.context.organizationId, { requireMfa: b.requireMfa }, mode);
  return NextResponse.json({ requireMfa: updated?.requireMfa === true });
}
