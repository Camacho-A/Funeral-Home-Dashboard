'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { acceptInvitation } from '@/services/invitationService';
import { getIdentityById, recordSuccessfulLogin } from '@/services/identityService';
import { recordLoginActivity } from '@/services/accountRecoveryService';
import { createIdentitySession } from '@/services/sessionService';
import { createSession } from '@/lib/auth/session';

/**
 * Phase 21 (Identity, Authentication & Session Management). Mirrors
 * POST /api/auth/accept-invitation's own logic (see that route's comment
 * for why signing the invitee straight in is the right default) — called
 * directly rather than fetched, for the same reason every other page in
 * this phase's public flow calls services/* directly instead of its own
 * Route Handler.
 */
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const query = `token=${encodeURIComponent(token)}&membershipId=${encodeURIComponent(membershipId)}`;

  if (password.length < 8) {
    redirect(`/accept-invitation?${query}&error=too_short`);
  }
  if (password !== confirmPassword) {
    redirect(`/accept-invitation?${query}&error=mismatch`);
  }

  const dataAdapterMode = getDataAdapterMode();
  const result = await acceptInvitation({ token, membershipId, password }, dataAdapterMode);
  if (!result.success) {
    redirect(`/accept-invitation?${query}&error=invalid`);
  }

  const identity = await getIdentityById(result.identityId, dataAdapterMode);
  if (!identity) {
    redirect(`/accept-invitation?${query}&error=invalid`);
  }

  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = requestHeaders.get('user-agent');
  const idFactory = () => crypto.randomUUID();

  await recordLoginActivity({ identityId: identity.id, eventType: 'invitation_accepted', ipAddress, userAgent, idFactory }, dataAdapterMode);
  await recordSuccessfulLogin(identity.id, dataAdapterMode);

  const identitySession = await createIdentitySession(
    {
      identityId: identity.id,
      deviceId: idFactory(),
      deviceName: userAgent,
      ipAddress,
      userAgent,
      rememberDevice: false,
      passwordVersionAtIssue: identity.passwordVersion,
      idFactory,
    },
    dataAdapterMode,
  );

  await createSession(
    { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' },
    identitySession.id,
  );

  redirect('/dashboard');
}
