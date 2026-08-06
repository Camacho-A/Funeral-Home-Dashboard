import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canSendPortalMessage } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { listMessagesForCase, sendStaffMessage } from '@/services/portal/portalMessagingService';

const MAX_BODY_LENGTH = 5000;

/**
 * Phase 29 (Family Portal & External Collaboration). Staff-side, gated by
 * `portal.message` — distinct from `portal.manage` (a staff member can
 * message a family without being able to invite/revoke their access).
 * Delegates entirely to `services/portal/portalMessagingService.ts`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canSendPortalMessage({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to read Family Portal messages for this case.' }, { status: 403 });
  }

  const messages = await listMessagesForCase(organizationId, caseId, dataAdapterMode);
  return NextResponse.json({ messages });
}

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
  const b = body as { organizationId?: unknown; body?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: `A non-empty message body (max ${MAX_BODY_LENGTH} characters) is required.` }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canSendPortalMessage({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to send Family Portal messages for this case.' }, { status: 403 });
  }

  const message = await sendStaffMessage(
    { organizationId, caseId, body: b.body, idFactory: () => crypto.randomUUID() },
    { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
    dataAdapterMode,
  );

  return NextResponse.json({ message }, { status: 201 });
}
