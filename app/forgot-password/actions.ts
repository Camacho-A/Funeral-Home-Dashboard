'use server';

import { redirect } from 'next/navigation';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { findIdentityByEmail } from '@/services/identityService';
import { createPasswordResetToken } from '@/services/passwordService';
import { getIdentityMessageSender } from '@/lib/identity/messageSender';

/**
 * Phase 21 (Identity, Authentication & Session Management). Calls
 * services/passwordService.ts directly rather than fetching this app's own
 * POST /api/auth/forgot-password route — a Server Action doing a
 * same-process self-HTTP-call would be pure overhead; the Route Handler
 * exists for the spec's own listed API surface and any non-browser
 * consumer, not for this page. Same "never reveal whether an email
 * exists" generic outcome either way.
 *
 * Security correction (2026-07-25): this action used to pass the raw
 * reset token through a `devToken` query parameter for local-testing
 * convenience — a real vulnerability (the token would appear in browser
 * history, referrer headers, and server logs, not just a developer's own
 * terminal). It now flows only into `getIdentityMessageSender().send()` —
 * in development that's a server-console log, never anything
 * URL/response-visible; in production, sending fails loudly server-side
 * (logged) without changing what the browser sees either way.
 */
export async function forgotPasswordAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const dataAdapterMode = getDataAdapterMode();

  const identity = await findIdentityByEmail(email, dataAdapterMode);
  if (identity && identity.status !== 'disabled' && identity.status !== 'deleted') {
    const { token } = await createPasswordResetToken(identity.id, () => crypto.randomUUID(), dataAdapterMode);
    try {
      await getIdentityMessageSender().send({ kind: 'password_reset', to: identity.email, token });
    } catch (error) {
      console.error('Failed to send password reset message:', error instanceof Error ? error.message : error);
    }
  }

  redirect('/forgot-password?sent=1');
}
