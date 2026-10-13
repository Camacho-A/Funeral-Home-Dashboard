import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { markAllReadForIdentity } from '@/services/notificationService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Notification Center (2026-10). "Mark all as read" for the caller's own
 * inbox.
 *
 * Deliberately takes no recipient ids from the client: the identity is
 * re-derived from the session by `requireAuthorizedOrganization`, and the
 * service marks only rows already belonging to that identity in that
 * organization. There is no shape of request that lets a caller mark
 * somebody else's notifications read.
 *
 * Like the single mark-read route, no permission gate — "no permission
 * needed for your own inbox" (ADR-032).
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

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

  const result = await markAllReadForIdentity(
    organizationId,
    userId,
    {
      organizationId,
      actorIdentityId: userId,
      actorMembershipId: null,
      actorRoleKey: role,
      correlationId: crypto.randomUUID(),
    },
    getDataAdapterMode(),
  );

  return NextResponse.json(result);
}
