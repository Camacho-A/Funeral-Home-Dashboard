import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { resolveStaffProfileForCaller, StaffAssignmentError } from '@/services/staffProfileService';
import { beginAuthorization, CalendarConnectionServiceError } from '@/services/calendarConnectionService';
import { OAUTH_STATE_COOKIE_NAME, oauthStateCookieOptions } from '@/lib/auth/calendarOAuthState';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Kicks off the Google OAuth flow for the CALLER's own
 * calendar — always same-origin (a staff member clicking "Connect
 * Google" in Settings), so `requireSameOrigin` applies here exactly
 * like any other state-changing route; only the paired `callback`
 * route (the genuinely cross-origin leg) is exempt. Returns the
 * provider's authorize URL as JSON rather than issuing a redirect
 * itself — no existing route in this codebase does a server-side
 * redirect from a CSRF-checked POST, and a same-origin `fetch()` can't
 * follow a cross-origin redirect usefully anyway; the client navigates
 * (`window.location.assign(authorizeUrl)`) after receiving this
 * response, by which point the state cookie below is already set.
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
  const { organizationId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
  if (!staffProfile) {
    return NextResponse.json({ error: 'No active staff profile found for this organization.' }, { status: 403 });
  }

  try {
    const { authorizeUrl, stateCookieValue } = await beginAuthorization(organizationId, staffProfile.id, 'google', dataAdapterMode);
    const store = await cookies();
    store.set(OAUTH_STATE_COOKIE_NAME, stateCookieValue, oauthStateCookieOptions());
    return NextResponse.json({ authorizeUrl });
  } catch (error) {
    if (error instanceof StaffAssignmentError || error instanceof CalendarConnectionServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
