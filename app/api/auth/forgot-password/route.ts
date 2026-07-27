import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { findIdentityByEmail } from '@/services/identityService';
import { createPasswordResetToken } from '@/services/passwordService';
import { getIdentityMessageSender } from '@/lib/identity/messageSender';

const GENERIC_RESPONSE = { ok: true, message: 'If an account exists for that email, a password reset link has been sent.' };

/**
 * Phase 21 (Identity, Authentication & Session Management), security
 * correction (2026-07-25): the raw reset token used to be returned
 * directly in this response — a real vulnerability (anyone who could call
 * this route, or intercept the response, got the reset capability
 * directly, without ever proving they control the target inbox). It now
 * flows only into `getIdentityMessageSender().send()` — see that module's
 * own comment for how delivery is chosen per environment.
 *
 * "Never reveal whether an email exists": this always returns the same
 * 200 body and status regardless of whether `email` resolves to a real,
 * active identity, *and* regardless of whether the message send itself
 * succeeded or failed — a delivery failure is logged server-side but
 * never changes what the caller sees, so a production outage of the
 * (currently unconfigured) message provider can never be distinguished
 * from "no such identity" by an outside caller.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { email } = parsed.body;

  if (typeof email !== 'string' || email.trim().length === 0) {
    return NextResponse.json({ error: 'email is required.' }, { status: 400 });
  }

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

  return NextResponse.json(GENERIC_RESPONSE);
}
