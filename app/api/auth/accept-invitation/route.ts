import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { acceptInvitation } from '@/services/invitationService';
import { getIdentityById, recordSuccessfulLogin } from '@/services/identityService';
import { recordLoginActivity } from '@/services/accountRecoveryService';
import { createIdentitySession } from '@/services/sessionService';
import { createSession } from '@/lib/auth/session';

const ERROR_STATUS: Record<string, number> = {
  invalid_token: 400,
  expired_token: 400,
  already_used: 400,
  membership_not_found: 404,
};

/**
 * Phase 21 (Identity, Authentication & Session Management). "Accept
 * Invitation -> Verify Email -> Create Password -> Membership Activated,"
 * then signs the invitee straight in — there's no security benefit to
 * making someone who just proved email ownership and set a password
 * re-enter both a second time on a separate login screen, and every other
 * identity-mode login path (app/login/actions.ts's handleIdentityLogin)
 * already establishes the pattern this mirrors: record login activity,
 * bump lastLoginAt, create a registry session row, issue the signed
 * cookie linked to it. The membership's organization is intentionally
 * *not* pre-selected on the new session — the ordinary
 * resolveMembershipAuthorizationContext auto-select path (a single active
 * membership) picks it up on first page load exactly as it would for any
 * other single-organization identity.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { token, membershipId, password } = parsed.body;

  if (typeof token !== 'string' || token.trim().length === 0) {
    return NextResponse.json({ error: 'token is required.' }, { status: 400 });
  }
  if (typeof membershipId !== 'string' || membershipId.trim().length === 0) {
    return NextResponse.json({ error: 'membershipId is required.' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters.' }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const result = await acceptInvitation({ token, membershipId, password }, dataAdapterMode);
  if (!result.success) {
    return NextResponse.json({ error: 'This invitation link is invalid or has expired.' }, { status: ERROR_STATUS[result.reason] ?? 400 });
  }

  const identity = await getIdentityById(result.identityId, dataAdapterMode);
  if (!identity) {
    return NextResponse.json({ error: 'Something went wrong completing your invitation.' }, { status: 500 });
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

  return NextResponse.json({ ok: true, membership: result.membership });
}
