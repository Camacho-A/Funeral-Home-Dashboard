import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageRoles } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { getManorsCaseNumberManageMigrationStatus, seedManorsCaseNumberManagePermission } from '@/services/roleService';

/**
 * Manors RBAC production migration (2026-09) — a narrowly-scoped, ONE-TIME
 * backfill, NOT a general-purpose permission editor. `caseNumber.manage`
 * was added to the platform's permission catalog and to the
 * Administrator/Funeral Director role definitions in code, but
 * managed-cremations is an already-active organization whose live
 * `rolePermissions` data was only ever written once, at onboarding time —
 * see `services/roleService.ts`'s "Manors RBAC production migration"
 * section for the full mechanism this route calls into.
 *
 * Hardcoded end-to-end: organization ('managed-cremations'), permission
 * ('caseNumber.manage'), and target role keys (administrator,
 * funeralDirector) are all fixed server-side — no client-supplied
 * permission key, target role, or organization selection exists anywhere
 * in this route. A caller authorized for a *different* organization simply
 * gets `applicable: false` back; the migration never runs against
 * anything but Manors.
 *
 * Authorization deliberately uses `canManageRoles` (`user.manageRoles`),
 * NOT `canManageCaseNumbering` — the whole point of this route is that
 * `caseNumber.manage` does not exist in live production data yet, so
 * gating on it would make the migration unreachable by the very people who
 * need to run it. `user.manageRoles` is the narrowest existing permission
 * that is Administrator-only among every default role (confirmed: no
 * other default role, including Funeral Director, holds it) — the correct
 * "can administer this organization's RBAC" authority for this action.
 */
const MANORS_ORGANIZATION_ID = 'managed-cremations';

/** GET — read-only status check, used to decide whether to show the
    "Enable Case Numbering Access" action at all. Never mutates. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId } = authResult.context;

  const mode = getDataAdapterMode();
  if (!(await canManageRoles({ identityId: authResult.context.userId, organizationId: resolvedOrganizationId, roleKey: authResult.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  if (resolvedOrganizationId !== MANORS_ORGANIZATION_ID) {
    return NextResponse.json({ organizationId: resolvedOrganizationId, applicable: false, needsMigration: false });
  }

  if (mode !== 'wix') {
    return NextResponse.json({ error: 'This action only applies when DATA_ADAPTER=wix.' }, { status: 400 });
  }

  const status = await getManorsCaseNumberManageMigrationStatus(MANORS_ORGANIZATION_ID, mode);
  return NextResponse.json({ ...status, applicable: true, needsMigration: !status.administratorGranted || !status.funeralDirectorGranted });
}

/** POST — executes the migration. Authorization + target organization are
    always re-verified here from scratch, never trusting an earlier GET. */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const mode = getDataAdapterMode();
  if (!(await canManageRoles({ identityId: authResult.context.userId, organizationId, roleKey: authResult.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  if (organizationId !== MANORS_ORGANIZATION_ID) {
    return NextResponse.json({ error: 'This action is only available for the Manors organization.' }, { status: 400 });
  }

  if (mode !== 'wix') {
    return NextResponse.json({ error: 'This action only applies when DATA_ADAPTER=wix.' }, { status: 400 });
  }

  try {
    const result = await seedManorsCaseNumberManagePermission({ organizationId, actorIdentityId: authResult.context.userId }, mode);
    return NextResponse.json({ ...result, applicable: true, needsMigration: false });
  } catch (error) {
    // A rejected/thrown grant or audit write never leaves a partial
    // success response — the caller sees a clear failure and nothing here
    // claims the migration completed.
    const message = error instanceof Error ? error.message : 'Failed to enable Case Numbering access.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
