import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { markRead, archiveNotificationForRecipient, NotificationServiceError } from '@/services/notificationService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 28 (Communications & Notifications). Mark read / archive — scoped
 * entirely to the caller's own `NotificationRecipient` row (the service
 * layer itself rejects a mismatch), never gated by a permission; per the
 * approved Phase 28 plan, "no permission needed for your own inbox".
 *
 * Nested under `/notifications/recipients/` rather than directly under
 * `/notifications/[notificationRecipientId]` because Next.js's App Router
 * forbids two sibling dynamic segments with different parameter names at
 * the same path depth — `/notifications/[notificationId]/cancel` already
 * claims that depth (see that route's own file).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ notificationRecipientId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { notificationRecipientId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; action?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (b.action !== 'read' && b.action !== 'archive') {
    return NextResponse.json({ error: 'action must be "read" or "archive".' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  try {
    const recipient =
      b.action === 'read'
        ? await markRead(
            organizationId,
            notificationRecipientId,
            userId,
            { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
            dataAdapterMode,
          )
        : await archiveNotificationForRecipient(organizationId, notificationRecipientId, userId, dataAdapterMode);
    return NextResponse.json({ recipient });
  } catch (error) {
    if (error instanceof NotificationServiceError) {
      const status = error.message.includes('not found') ? 404 : error.message.includes('does not belong') ? 403 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
