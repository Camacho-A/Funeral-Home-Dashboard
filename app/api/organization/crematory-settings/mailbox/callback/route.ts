import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyOAuthStateCookie } from '@/lib/auth/calendarOAuthState';
import { authorizeCrematory } from '@/lib/crematory/routeAuth';
import { completeMailboxAuthorization, CrematoryMailboxError, MAILBOX_OAUTH_COOKIE_NAME } from '@/services/crematory/crematoryMailboxService';

/**
 * Send to Crematory (2026-10). Microsoft redirects here after the
 * administrator signs in as the shared mailbox (MICROSOFT_MAIL_REDIRECT_URI
 * must point at this route). Always ends on Settings → Crematory.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const done = (query: string) => {
    const response = NextResponse.redirect(new URL(`/settings/crematory?${query}`, url.origin));
    response.cookies.delete(MAILBOX_OAUTH_COOKIE_NAME);
    return response;
  };
  const error = url.searchParams.get('error');
  if (error) return done(`mailboxError=${encodeURIComponent(url.searchParams.get('error_description') ?? error)}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieValue = (await cookies()).get(MAILBOX_OAUTH_COOKIE_NAME)?.value;
  const payload = state ? verifyOAuthStateCookie(cookieValue, state) : null;
  if (!code || !state || !payload) return done('mailboxError=The%20Microsoft%20sign-in%20expired.%20Please%20try%20again.');

  // The same administrator, still signed in to SOLIS for that organization.
  const auth = await authorizeCrematory(payload.organizationId, 'manage');
  if (!auth.context || auth.context.userId !== payload.staffProfileId) return done('mailboxError=Sign%20in%20to%20SOLIS%20as%20an%20administrator%20and%20try%20again.');
  try {
    const { accountEmail } = await completeMailboxAuthorization(code, cookieValue, state, auth.context.organizationId, auth.mode);
    return done(`mailboxConnected=${encodeURIComponent(accountEmail)}`);
  } catch (e) {
    return done(`mailboxError=${encodeURIComponent(e instanceof CrematoryMailboxError ? e.message : 'The mailbox could not be connected.')}`);
  }
}
