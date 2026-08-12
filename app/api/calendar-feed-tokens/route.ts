import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { listTokensForStaffProfile, generateFeedToken } from '@/services/calendarFeedTokenService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Self-scoped feed-token management — a staff member's own
 * personal ICS subscription link, mirroring
 * `app/api/calendar-connections/route.ts`'s exact "no permission beyond
 * authentication" posture (§9/§19 of the plan). `POST` returns the raw
 * token exactly once, in this response only — never persisted, never
 * retrievable again after this call.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
  if (!staffProfile) {
    return NextResponse.json({ tokens: [] });
  }
  const tokens = await listTokensForStaffProfile(organizationId, staffProfile.id, dataAdapterMode);
  return NextResponse.json({ tokens });
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
  const b = body as { organizationId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
  if (!staffProfile) {
    return NextResponse.json({ error: 'No active staff profile found for this organization.' }, { status: 403 });
  }

  const { token, rawToken } = await generateFeedToken(organizationId, staffProfile.id, () => crypto.randomUUID(), dataAdapterMode);
  return NextResponse.json({ token, rawToken }, { status: 201 });
}
