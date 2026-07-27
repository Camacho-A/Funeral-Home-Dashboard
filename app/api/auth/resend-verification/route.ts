import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { findIdentityByEmail } from '@/services/identityService';
import { resendVerification } from '@/services/emailVerificationService';
import { getIdentityMessageSender } from '@/lib/identity/messageSender';

const GENERIC_RESPONSE = { ok: true, message: 'If an account exists for that email and needs verification, a new link has been sent.' };

/**
 * Phase 21 (Identity, Authentication & Session Management), security
 * correction (2026-07-25): the raw verification token used to be returned
 * directly in this response. See app/api/auth/forgot-password/route.ts's
 * own comment — same fix, same reasoning, applied here.
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

  if (identity && !identity.emailVerified) {
    const { token } = await resendVerification(identity.id, () => crypto.randomUUID(), dataAdapterMode);
    try {
      await getIdentityMessageSender().send({ kind: 'email_verification', to: identity.email, token });
    } catch (error) {
      console.error('Failed to send verification message:', error instanceof Error ? error.message : error);
    }
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
