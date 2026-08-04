import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { getUnreadCount } from '@/services/notificationService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 28 (Communications & Notifications). Backs the TopBar bell's
 * unread badge — always a fresh, live query (see
 * `services/notificationService.ts`'s `getUnreadCount`), never a
 * client-cached running total. No permission beyond authentication: this
 * is always the caller's own count.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const count = await getUnreadCount(organizationId, userId, dataAdapterMode);
  return NextResponse.json({ count });
}
