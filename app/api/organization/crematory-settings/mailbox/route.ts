import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { oauthStateCookieOptions } from '@/lib/auth/calendarOAuthState';
import { authorizeCrematory } from '@/lib/crematory/routeAuth';
import { beginMailboxAuthorization, CrematoryMailboxError, disconnectCrematoryMailbox, MAILBOX_OAUTH_COOKIE_NAME } from '@/services/crematory/crematoryMailboxService';

/**
 * Send to Crematory (2026-10) — administrators connect (POST) or
 * disconnect (DELETE) the shared Outlook mailbox. POST returns the
 * Microsoft sign-in URL; the administrator signs in AS the shared mailbox.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const body = ((await request.json().catch(() => ({}))) ?? {}) as { organizationId?: unknown };
  const auth = await authorizeCrematory(body.organizationId, 'manage');
  if (!auth.context) return auth.response;
  try {
    const { authorizeUrl, cookieValue } = beginMailboxAuthorization(auth.context.organizationId, auth.context.userId);
    const response = NextResponse.json({ authorizeUrl });
    response.cookies.set(MAILBOX_OAUTH_COOKIE_NAME, cookieValue, oauthStateCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof CrematoryMailboxError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function DELETE(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const auth = await authorizeCrematory(new URL(request.url).searchParams.get('organizationId'), 'manage');
  if (!auth.context) return auth.response;
  await disconnectCrematoryMailbox(auth.context.organizationId, auth.mode);
  return NextResponse.json({ disconnected: true });
}
