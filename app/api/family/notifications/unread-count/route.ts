import { NextResponse } from 'next/server';
import { requireFamilySession } from '@/lib/auth/requireFamilySession';
import { getPrimaryOrganizationIdForPortalUser } from '@/services/portal/portalAccessService';
import { getUnreadCount } from '@/services/notificationService';

/** Phase 29 (Family Portal & External Collaboration). Self-scoped, no
    capability check — mirrors `/api/notifications/unread-count`. */
export async function GET() {
  const sessionResult = await requireFamilySession();
  if (!sessionResult.authorized) return sessionResult.response;

  const organizationId = await getPrimaryOrganizationIdForPortalUser(sessionResult.portalUser.id, sessionResult.dataAdapterMode);
  if (!organizationId) {
    return NextResponse.json({ count: 0 });
  }

  const count = await getUnreadCount(organizationId, sessionResult.portalUser.id, sessionResult.dataAdapterMode);
  return NextResponse.json({ count });
}
