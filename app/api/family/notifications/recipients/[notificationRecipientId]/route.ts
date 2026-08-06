import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireFamilySession } from '@/lib/auth/requireFamilySession';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getPrimaryOrganizationIdForPortalUser } from '@/services/portal/portalAccessService';
import { markRead, archiveNotificationForRecipient, NotificationServiceError } from '@/services/notificationService';
import { portalActivityContext } from '@/services/portal/portalActivityContext';

/** Phase 29 (Family Portal & External Collaboration). Mark read / archive
    — scoped entirely to the caller's own `NotificationRecipient` row
    (the service layer itself rejects a mismatch), mirroring
    `/api/notifications/recipients/[notificationRecipientId]` exactly. */
export async function PATCH(request: Request, { params }: { params: Promise<{ notificationRecipientId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const sessionResult = await requireFamilySession();
  if (!sessionResult.authorized) return sessionResult.response;

  const { notificationRecipientId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { action?: unknown };
  if (b.action !== 'read' && b.action !== 'archive') {
    return NextResponse.json({ error: 'action must be "read" or "archive".' }, { status: 400 });
  }

  const organizationId = await getPrimaryOrganizationIdForPortalUser(sessionResult.portalUser.id, sessionResult.dataAdapterMode);
  if (!organizationId) {
    return NextResponse.json({ error: 'Notification recipient not found.' }, { status: 404 });
  }

  try {
    const recipient =
      b.action === 'read'
        ? await markRead(
            organizationId,
            notificationRecipientId,
            sessionResult.portalUser.id,
            portalActivityContext(organizationId, crypto.randomUUID()),
            sessionResult.dataAdapterMode,
          )
        : await archiveNotificationForRecipient(organizationId, notificationRecipientId, sessionResult.portalUser.id, sessionResult.dataAdapterMode);
    return NextResponse.json({ recipient });
  } catch (error) {
    if (error instanceof NotificationServiceError) {
      const status = error.message.includes('not found') ? 404 : error.message.includes('does not belong') ? 403 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
