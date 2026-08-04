import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getPreferences, updatePreferences } from '@/services/notificationService';
import type { NotificationPreferencePatch } from '@/types/notificationPreference';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 28 (Communications & Notifications). The caller's own
 * `NotificationPreference` — no permission beyond authentication, since
 * this is always self-scoped. Only `emailEnabled`/`inAppEnabled` are
 * exposed this phase; digest frequency/quiet hours/per-category overrides
 * are schema-only reserves (see `types/notificationPreference.ts`).
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

  const preferences = await getPreferences(organizationId, userId, dataAdapterMode);
  return NextResponse.json({ preferences });
}

export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; emailEnabled?: unknown; inAppEnabled?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (b.emailEnabled !== undefined && typeof b.emailEnabled !== 'boolean') {
    return NextResponse.json({ error: 'emailEnabled must be a boolean if provided.' }, { status: 400 });
  }
  if (b.inAppEnabled !== undefined && typeof b.inAppEnabled !== 'boolean') {
    return NextResponse.json({ error: 'inAppEnabled must be a boolean if provided.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  // Only include keys the caller actually sent — an explicit `undefined`
  // in the patch object would overwrite the existing stored value (an
  // object spread does not distinguish "key absent" from "key set to
  // undefined"), silently clobbering whichever field wasn't part of this
  // particular request.
  const patch: NotificationPreferencePatch = {};
  if (typeof b.emailEnabled === 'boolean') patch.emailEnabled = b.emailEnabled;
  if (typeof b.inAppEnabled === 'boolean') patch.inAppEnabled = b.inAppEnabled;

  const preferences = await updatePreferences(organizationId, userId, patch, dataAdapterMode);
  return NextResponse.json({ preferences });
}
