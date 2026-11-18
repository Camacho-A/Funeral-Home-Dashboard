import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getDataAdapterMode } from '@/lib/env';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { changeCredentials, CredentialServiceError, listCredentialSummaries } from '@/services/funeralDirectorCredentialService';
import type { CredentialChange } from '@/domain/staff/funeralDirectorCredentials';

/**
 * Settings › Funeral Director Credentials (Gus Phase 5G, 2026-11).
 *   GET  ?organizationId= → every staff member's credential record and check
 *   POST { organizationId, staffProfileId, expectedRevision, change }
 * Administrators only (organization.manage). Nobody changes their own
 * credentials. Managing credentials never permits release by itself.
 */
async function authorize(organizationId: unknown) {
  if (typeof organizationId !== 'string' || !organizationId) return { response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  const auth = await requireAuthorizedOrganization(organizationId);
  if (!auth.authorized) return { response: auth.response };
  const { organizationId: org, userId, role } = auth.context;
  const mode = getDataAdapterMode();
  if (!(await canManageOrganization({ identityId: userId, organizationId: org, roleKey: role }, mode))) {
    return { response: NextResponse.json({ error: 'Only an administrator can manage funeral director credentials.' }, { status: 403 }) };
  }
  return { context: { organizationId: org, userId, role, mode } };
}

function errorResponse(error: unknown) {
  if (error instanceof CredentialServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('Funeral director credential request failed:', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: 'Could not complete the request. Please try again.' }, { status: 500 });
}

function parseChange(raw: unknown): CredentialChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : null);
  if (c.kind === 'set_license') {
    const [licenseNumber, state, licenseType, status, expiresOn] = [s(c.licenseNumber), s(c.state), s(c.licenseType), s(c.status), s(c.expiresOn)];
    if (licenseNumber === null || state === null || licenseType === null || status === null || expiresOn === null) return null;
    return { kind: 'set_license', licenseNumber, state, licenseType, status: status as never, expiresOn };
  }
  if (c.kind === 'verify_license') {
    const reference = s(c.reference);
    return reference !== null && (c.method === 'state_license_lookup' || c.method === 'license_document') ? { kind: 'verify_license', method: c.method, reference } : null;
  }
  if (c.kind === 'grant_authorization') return { kind: 'grant_authorization' };
  if (c.kind === 'revoke_authorization') {
    const reason = s(c.reason);
    return reason !== null ? { kind: 'revoke_authorization', reason } : null;
  }
  return null;
}

export async function GET(request: Request) {
  const result = await authorize(new URL(request.url).searchParams.get('organizationId'));
  if (!result.context) return result.response;
  try {
    return NextResponse.json({ staff: await listCredentialSummaries(result.context.organizationId, result.context.mode) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const result = await authorize(body.organizationId);
  if (!result.context) return result.response;
  const { organizationId, userId, role, mode } = result.context;
  const change = parseChange(body.change);
  if (!change || typeof body.staffProfileId !== 'string' || typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision)) {
    return NextResponse.json({ error: 'staffProfileId, expectedRevision and a valid change are required.' }, { status: 400 });
  }
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const actorName = (await resolveStaffProfileForCaller({ organizationId, userId, role }, mode))?.displayName ?? null;
    const record = await changeCredentials(ctx, { staffProfileId: body.staffProfileId, change, expectedRevision: body.expectedRevision, actorName }, mode);
    return NextResponse.json({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
