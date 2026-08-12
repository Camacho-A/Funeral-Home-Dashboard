import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { completeAuthorization, CalendarConnectionServiceError } from '@/services/calendarConnectionService';
import { OAUTH_STATE_COOKIE_NAME } from '@/lib/auth/calendarOAuthState';
import { getDataAdapterMode } from '@/lib/env';

const SETTINGS_PATH = '/settings/calendar-integrations';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Google's own redirect back to Beacon — genuinely
 * cross-origin, so `requireSameOrigin` does not (and cannot) apply
 * here; `completeAuthorization`'s signed-state-cookie verification is
 * the substitute authenticity check, mirroring
 * `app/api/webhooks/clover/route.ts`'s own precedent. Every outcome
 * (success, provider error, missing params, state mismatch, exchange
 * failure) ends in the same redirect back to the Settings page — never
 * a raw JSON error page, since a real browser lands here mid-navigation.
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
    const connection = await completeAuthorization('google', code, stateCookieValue, state, getDataAdapterMode());
    redirectTo.searchParams.set('calendarConnected', connection.provider);
    return NextResponse.redirect(redirectTo);
  } catch (error) {
    redirectTo.searchParams.set('calendarError', error instanceof CalendarConnectionServiceError ? error.message : 'connection_failed');
    return NextResponse.redirect(redirectTo);
  }
}
