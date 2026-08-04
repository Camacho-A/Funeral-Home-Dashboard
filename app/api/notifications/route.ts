import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canSendNotification } from '@/services/authorizationPolicyService';
import { createNotification, listForRecipient, NotificationServiceError } from '@/services/notificationService';
import { NOTIFICATION_CATEGORY_LABEL, type NotificationCategory } from '@/domain/notifications/notificationTypeRegistry';
import { getDataAdapterMode } from '@/lib/env';

const VALID_RECIPIENT_SCOPES: readonly string[] = ['individual', 'role', 'organization_wide', 'case_participants'];
const VALID_CATEGORIES: readonly string[] = Object.keys(NOTIFICATION_CATEGORY_LABEL);

/**
 * Phase 28 (Communications & Notifications). Dual-mode
 * `requireAuthorizedOrganization`, matching every other business-data
 * route (scheduling, documents) — the notification bell/drawer this backs
 * renders in `TopBar.tsx` regardless of auth mode. GET is the caller's own
 * inbox — "no permission needed for your own inbox" per the approved
 * Phase 28 plan: scoped entirely by the caller's own identity, never a
 * `canX` check. POST (manual send/broadcast) is gated by
 * `notification.send`. Delegates entirely to
 * `services/notificationService.ts`.
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

  const categoryParam = url.searchParams.get('category');
  const category = categoryParam && VALID_CATEGORIES.includes(categoryParam) ? (categoryParam as NotificationCategory) : undefined;
  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : 25;

  const result = await listForRecipient(
    organizationId,
    userId,
    { category, unreadOnly: url.searchParams.get('unreadOnly') === 'true', includeArchived: url.searchParams.get('includeArchived') === 'true' },
    cursor,
    limit,
    dataAdapterMode,
  );
  return NextResponse.json({ items: result.items, nextCursor: result.nextCursor });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as {
    organizationId?: unknown;
    notificationType?: unknown;
    recipientScope?: unknown;
    recipientIdentityId?: unknown;
    recipientRoleKey?: unknown;
    caseId?: unknown;
    entityType?: unknown;
    entityId?: unknown;
    actionUrl?: unknown;
    tokens?: unknown;
    saveAsDraft?: unknown;
  };

  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.notificationType !== 'string') return NextResponse.json({ error: 'notificationType is required.' }, { status: 400 });
  if (typeof b.recipientScope !== 'string' || !VALID_RECIPIENT_SCOPES.includes(b.recipientScope)) {
    return NextResponse.json({ error: 'A valid recipientScope is required.' }, { status: 400 });
  }
  if (b.tokens !== undefined && (typeof b.tokens !== 'object' || b.tokens === null)) {
    return NextResponse.json({ error: 'tokens must be an object if provided.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canSendNotification({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to send notifications for this organization.' }, { status: 403 });
  }

  try {
    const notification = await createNotification(
      {
        notificationType: b.notificationType,
        recipientScope: b.recipientScope as never,
        recipientIdentityId: typeof b.recipientIdentityId === 'string' ? b.recipientIdentityId : undefined,
        recipientRoleKey: typeof b.recipientRoleKey === 'string' ? b.recipientRoleKey : undefined,
        caseId: typeof b.caseId === 'string' ? b.caseId : undefined,
        entityType: typeof b.entityType === 'string' ? b.entityType : undefined,
        entityId: typeof b.entityId === 'string' ? b.entityId : undefined,
        actionUrl: typeof b.actionUrl === 'string' ? b.actionUrl : undefined,
        tokens: (b.tokens as Record<string, string> | undefined) ?? {},
        saveAsDraft: b.saveAsDraft === true,
        idFactory: () => crypto.randomUUID(),
      },
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ notification }, { status: 201 });
  } catch (error) {
    if (error instanceof NotificationServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
