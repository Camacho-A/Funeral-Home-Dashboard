import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadNotifications } from '@/services/authorizationPolicyService';
import { listForOrganization } from '@/services/notificationService';
import { NOTIFICATION_CATEGORY_LABEL, type NotificationCategory } from '@/domain/notifications/notificationTypeRegistry';
import { getDataAdapterMode } from '@/lib/env';

const VALID_CATEGORIES: readonly string[] = Object.keys(NOTIFICATION_CATEGORY_LABEL);

/**
 * Phase 28 (Communications & Notifications). The organization-wide
 * notification log — a plain query projection over `Notification`
 * (see `services/notificationService.ts`'s `listForOrganization`), never a
 * second audit system; `ActivityService`'s own `/api/activity` route
 * remains the one real audit trail. Gated by `notification.read`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId: requestedOrganizationId } = await params;

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadNotifications({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view the notification log for this organization.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const categoryParam = url.searchParams.get('category');
  const category = categoryParam && VALID_CATEGORIES.includes(categoryParam) ? (categoryParam as NotificationCategory) : undefined;
  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : 25;

  const result = await listForOrganization(organizationId, { category }, cursor, limit, dataAdapterMode);
  return NextResponse.json({ notifications: result.notifications, nextCursor: result.nextCursor });
}
