'use server';

import { redirect } from 'next/navigation';
import { getAuthAdapterMode } from '@/lib/env';
import { verifyMockCredentials } from '@/lib/auth/mockAuth';
import { loginWithWix } from '@/lib/auth/wixAuth';
import { createSession, clearSession } from '@/lib/auth/session';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';

/**
 * Phase 13 (Authentication & Organizations). Server Actions get Next.js's
 * built-in Origin-header CSRF protection for free — this is the "CSRF
 * protection where state-changing cookie-authenticated requests require
 * it" requirement, satisfied by using the platform's own mechanism rather
 * than hand-rolling a token scheme for these two actions.
 *
 * Never logs the submitted email, password, or any token — on failure,
 * only a generic `reason` code travels via the redirect URL (never the
 * credentials themselves), and the login page maps that code to a
 * deliberately non-specific message (lib/auth/mockAuth.ts's own comment
 * explains why "invalid email or password" is used regardless of which
 * part was actually wrong).
 *
 * Phase 15A.1 (Auth/Data Adapter Separation): branches on AUTH_ADAPTER,
 * not DATA_ADAPTER — which login provider is used is now independent of
 * which backend `services/*` read/write against, so e.g. DATA_ADAPTER=wix
 * with AUTH_ADAPTER=mock (real Wix-backed reads, mock login) works as a
 * real local-development combination. Neither verifyMockCredentials nor
 * loginWithWix themselves changed at all.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = sanitizeRedirectPath(String(formData.get('next') ?? ''));
  const nextParam = encodeURIComponent(next);

  const authAdapter = getAuthAdapterMode();

  if (authAdapter === 'mock') {
    const result = verifyMockCredentials(email, password);
    if (!result.success) {
      redirect(`/login?error=invalid_credentials&next=${nextParam}`);
    }
    await createSession(result.user);
    redirect(next);
  }

  let wixResult;
  try {
    wixResult = await loginWithWix(email, password);
  } catch {
    // Never surface the underlying SDK/network error to the client.
    redirect(`/login?error=unknown&next=${nextParam}`);
  }

  if (!wixResult.success) {
    redirect(`/login?error=${wixResult.reason}&next=${nextParam}`);
  }

  await createSession(wixResult.user);
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect('/login');
}
