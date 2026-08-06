import { NextResponse } from 'next/server';
import { requireFamilySession } from '@/lib/auth/requireFamilySession';
import { getPrimaryOrganizationIdForPortalUser } from '@/services/portal/portalAccessService';
import { listForRecipient } from '@/services/notificationService';

/**
 * Phase 29 (Family Portal & External Collaboration). The caller's own
 * inbox — no capability check beyond a verified session, mirroring
 * `/api/notifications`'s own "no permission needed for your own inbox"
 * precedent. `NotificationRecipient.identityId` holds this session's
 * `PortalUser.id` for any `recipientScope: 'portal_user'` notification —
 * see `types/notification.ts`'s own comment.
 */
export async function GET(request: Request) {
  const sessionResult = await requireFamilySession();
  if (!sessionResult.authorized) return sessionResult.response;

  const organizationId = await getPrimaryOrganizationIdForPortalUser(sessionResult.portalUser.id, sessionResult.dataAdapterMode);
  if (!organizationId) {
    return NextResponse.json({ items: [], nextCursor: null });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : 25;

  const result = await listForRecipient(
    organizationId,
    sessionResult.portalUser.id,
    { unreadOnly: url.searchParams.get('unreadOnly') === 'true', includeArchived: url.searchParams.get('includeArchived') === 'true' },
    cursor,
    limit,
    sessionResult.dataAdapterMode,
  );
  return NextResponse.json({ items: result.items, nextCursor: result.nextCursor });
}
