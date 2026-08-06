import { NextResponse } from 'next/server';
import { requireFamilySession } from '@/lib/auth/requireFamilySession';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getPrimaryOrganizationIdForPortalUser } from '@/services/portal/portalAccessService';
import { getPreferences, updatePreferences } from '@/services/notificationService';
import type { NotificationPreferencePatch } from '@/types/notificationPreference';

const NO_ORGANIZATION_PREFERENCES = { emailEnabled: true, inAppEnabled: true };

/** Phase 29 (Family Portal & External Collaboration). The caller's own
    preferences — self-scoped, mirrors `/api/notifications/preferences`. */
export async function GET() {
  const sessionResult = await requireFamilySession();
  if (!sessionResult.authorized) return sessionResult.response;

  const organizationId = await getPrimaryOrganizationIdForPortalUser(sessionResult.portalUser.id, sessionResult.dataAdapterMode);
  if (!organizationId) {
    return NextResponse.json({ preferences: NO_ORGANIZATION_PREFERENCES });
  }

  const preferences = await getPreferences(organizationId, sessionResult.portalUser.id, sessionResult.dataAdapterMode);
  return NextResponse.json({ preferences });
}

export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const sessionResult = await requireFamilySession();
  if (!sessionResult.authorized) return sessionResult.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { emailEnabled?: unknown; inAppEnabled?: unknown };
  if (b.emailEnabled !== undefined && typeof b.emailEnabled !== 'boolean') {
    return NextResponse.json({ error: 'emailEnabled must be a boolean if provided.' }, { status: 400 });
  }
  if (b.inAppEnabled !== undefined && typeof b.inAppEnabled !== 'boolean') {
    return NextResponse.json({ error: 'inAppEnabled must be a boolean if provided.' }, { status: 400 });
  }

  const organizationId = await getPrimaryOrganizationIdForPortalUser(sessionResult.portalUser.id, sessionResult.dataAdapterMode);
  if (!organizationId) {
    return NextResponse.json({ error: 'No active case access — preferences cannot be set yet.' }, { status: 422 });
  }

  const patch: NotificationPreferencePatch = {};
  if (typeof b.emailEnabled === 'boolean') patch.emailEnabled = b.emailEnabled;
  if (typeof b.inAppEnabled === 'boolean') patch.inAppEnabled = b.inAppEnabled;

  const preferences = await updatePreferences(organizationId, sessionResult.portalUser.id, patch, sessionResult.dataAdapterMode);
  return NextResponse.json({ preferences });
}
