import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { completeAuthorization, CalendarConnectionServiceError } from '@/services/calendarConnectionService';
import { OAUTH_STATE_COOKIE_NAME } from '@/lib/auth/calendarOAuthState';
import { getDataAdapterMode } from '@/lib/env';

const SETTINGS_PATH = '/settings/calendar-integrations';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Microsoft's own redirect back to Beacon — see
 * google/callback/route.ts's own comment for the full rationale
 * (genuinely cross-origin, state-cookie-verified, always redirects
 * back to Settings rather than returning a raw JSON error). Identical
 * shape, Microsoft provider only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  const store = await cookies();
  const stateCookieValue = store.get(OAUTH_STATE_COOKIE_NAME)?.value;
  store.delete(OAUTH_STATE_COOKIE_NAME);

  const redirectTo = new URL(SETTINGS_PATH, url.origin);

  if (providerError) {
    redirectTo.searchParams.set('calendarError', providerError);
    return NextResponse.redirect(redirectTo);
  }
  if (!code || !state) {
    redirectTo.searchParams.set('calendarError', 'missing_code_or_state');
    return NextResponse.redirect(redirectTo);
  }

  try {
    const connection = await completeAuthorization('microsoft', code, stateCookieValue, state, getDataAdapterMode());
    redirectTo.searchParams.set('calendarConnected', connection.provider);
    return NextResponse.redirect(redirectTo);
  } catch (error) {
    redirectTo.searchParams.set('calendarError', error instanceof CalendarConnectionServiceError ? error.message : 'connection_failed');
    return NextResponse.redirect(redirectTo);
  }
}
