import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageNotifications } from '@/services/authorizationPolicyService';
import { cancelNotification, NotificationServiceError } from '@/services/notificationService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 28 (Communications & Notifications). Cancels a still-`draft`/
 * `queued` notification — gated by `notification.manage`, matching every
 * other manage-tier scheduling/document/signature route.
 */
export async function POST(request: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { notificationId } = await params;

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
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageNotifications({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to cancel notifications for this organization.' }, { status: 403 });
  }

  try {
    const notification = await cancelNotification(
      organizationId,
      notificationId,
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ notification });
  } catch (error) {
    if (error instanceof NotificationServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 422 });
    }
    throw error;
  }
}
