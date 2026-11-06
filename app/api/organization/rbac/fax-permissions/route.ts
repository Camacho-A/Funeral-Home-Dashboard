import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageRoles } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { FaxPermissionMigrationError, applyFaxPermissionGrants, planFaxPermissionGrants } from '@/services/faxPermissionMigration';

/**
 * Fax permissions — live rollout (2026-11). A narrowly scoped, one-time
 * grant of the approved `fax.send` / `fax.confirm` matrix to the signed-in
 * administrator's OWN organization, as organization-level overrides
 * (services/faxPermissionMigration.ts). No permission key, role or
 * organization is ever taken from the request beyond the organization the
 * session is authorized for. Requires `user.manageRoles` (Administrator) —
 * not a fax permission, which by definition nobody holds yet.
 *
 *   GET  ?organizationId=…           → the plan (read-only)
 *   POST { organizationId }          → apply it; returns the plan afterwards
 */
async function authorize(organizationId: unknown) {
  if (typeof organizationId !== 'string' || !organizationId) return { response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  const auth = await requireAuthorizedOrganization(organizationId);
  if (!auth.authorized) return { response: auth.response };
  const mode = getDataAdapterMode();
  const { userId, role } = auth.context;
  if (!(await canManageRoles({ identityId: userId, organizationId: auth.context.organizationId, roleKey: role }, mode))) {
    return { response: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) };
  }
  return { context: auth.context, mode };
}

export async function GET(request: Request) {
  const auth = await authorize(new URL(request.url).searchParams.get('organizationId'));
  if (!auth.context) return auth.response;
  return NextResponse.json(await planFaxPermissionGrants(auth.context.organizationId, auth.mode), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  let body: { organizationId?: unknown };
  try {
    body = (await request.json()) as { organizationId?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const auth = await authorize(body.organizationId);
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json(await applyFaxPermissionGrants(auth.context.organizationId, auth.context.userId, auth.mode));
  } catch (error) {
    if (error instanceof FaxPermissionMigrationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Fax permission grants failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The fax permissions could not be granted. Nothing reported as done; check the plan and try again.' }, { status: 500 });
  }
}
