import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyOAuthStateCookie } from '@/lib/auth/calendarOAuthState';
import { authorizeCrematory } from '@/lib/crematory/routeAuth';
import {
  aadstsCode,
  completeMailboxAuthorization,
  CrematoryMailboxError,
  logMailboxDiagnostic,
  MailboxConnectError,
  MAILBOX_OAUTH_COOKIE_NAME,
  safeOAuthErrorCode,
} from '@/services/crematory/crematoryMailboxService';

/**
 * Send to Crematory (2026-10). Microsoft redirects here after the
 * administrator signs in to the mailbox SOLIS sends from
 * (MICROSOFT_MAIL_REDIRECT_URI must point at this route). Always ends on
 * Settings → Crematory.
 *
 * Connection diagnostics (2026-10): every way this can fail is logged as
 * one `[crematory-mailbox]` line — operation, step, category, HTTP status —
 * and shown to the administrator as a message naming the step. Never
 * logged or shown: the code, state, tokens, secret, or Microsoft's own
 * error text (only its OAuth error code and AADSTS number).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const done = (query: string) => {
    const response = NextResponse.redirect(new URL(`/settings/crematory?${query}`, url.origin));
    response.cookies.delete(MAILBOX_OAUTH_COOKIE_NAME);
    return response;
  };
  const fail = (message: string) => done(`mailboxError=${encodeURIComponent(message)}`);

  const error = url.searchParams.get('error');
  if (error) {
    const code = safeOAuthErrorCode(error);
    const aadsts = aadstsCode(url.searchParams.get('error_description'));
    logMailboxDiagnostic({ operation: 'mailbox_callback', stage: 'microsoft_authorization', category: aadsts ? `${code}:${aadsts}` : code, httpStatus: null });
    return fail(`Microsoft did not sign in the mailbox (${aadsts ?? code}).${aadsts === 'AADSTS50194' ? ' The app registration must allow accounts in any organizational directory (multitenant).' : ''}`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieValue = (await cookies()).get(MAILBOX_OAUTH_COOKIE_NAME)?.value;
  const payload = state ? verifyOAuthStateCookie(cookieValue, state) : null;
  if (!code || !state || !payload) {
    logMailboxDiagnostic({ operation: 'mailbox_callback', stage: 'sign_in_state', category: !code ? 'no_code' : !cookieValue ? 'no_state_cookie' : 'state_mismatch', httpStatus: null });
    return fail('The Microsoft sign-in expired. Please try again.');
  }

  // The same administrator, still signed in to SOLIS for that organization.
  const auth = await authorizeCrematory(payload.organizationId, 'manage');
  if (!auth.context || auth.context.userId !== payload.staffProfileId) {
    logMailboxDiagnostic({ operation: 'mailbox_callback', stage: 'administrator_check', category: auth.context ? 'different_user' : 'not_authorized', httpStatus: null });
    return fail('Sign in to SOLIS as an administrator and try again.');
  }
  try {
    const { accountEmail } = await completeMailboxAuthorization(code, cookieValue, state, auth.context.organizationId, auth.mode);
    return done(`mailboxConnected=${encodeURIComponent(accountEmail)}`);
  } catch (e) {
    if (e instanceof MailboxConnectError) {
      logMailboxDiagnostic(e.diagnostic);
      return fail(e.message);
    }
    if (e instanceof CrematoryMailboxError) {
      logMailboxDiagnostic({ operation: 'mailbox_connect', stage: 'unknown', category: 'refused', httpStatus: e.status });
      return fail(e.message);
    }
    logMailboxDiagnostic({ operation: 'mailbox_connect', stage: 'unknown', category: e instanceof Error ? e.name : 'unknown_error', httpStatus: null });
    return fail('The mailbox could not be connected (unexpected error — logged for SOLIS support).');
  }
}
