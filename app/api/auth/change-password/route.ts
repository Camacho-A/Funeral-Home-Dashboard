import { NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { changePassword } from '@/services/passwordService';
import { getIdentityById } from '@/services/identityService';
import { revokeAllSessionsForIdentity, refreshSessionPasswordVersion } from '@/services/sessionService';
import { clearSession } from '@/lib/auth/session';

/**
 * Phase 21 (Identity, Authentication & Session Management). "Changing a
 * password invalidates all previous sessions except the current one if
 * explicitly requested": the default here is the safer of the two —
 * revoke everywhere, including this device, forcing a fresh login — and a
 * caller passes `keepCurrentSession: true` to opt into the more
 * convenient "sign out other devices only" behavior instead.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { currentPassword, newPassword, keepCurrentSession } = parsed.body;

  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return NextResponse.json({ error: 'currentPassword is required.' }, { status: 400 });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return NextResponse.json({ error: 'newPassword must be at least 8 characters.' }, { status: 400 });
  }

  const result = await changePassword(identity.id, currentPassword, newPassword, dataAdapterMode);
  if (!result.success) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
  }

  const exceptSessionId = keepCurrentSession === true ? identitySession.id : undefined;
  await revokeAllSessionsForIdentity(identity.id, dataAdapterMode, exceptSessionId);

  if (exceptSessionId === undefined) {
    // The current browser's own cookie now points at a revoked registry
    // row — clear it immediately rather than leaving it to be rejected on
    // the caller's next request.
    await clearSession();
  } else {
    // The kept-alive session was issued under the *old* password version —
    // without this, lib/auth/resolveIdentitySession.ts's own version check
    // would reject it on its very next use, silently defeating
    // keepCurrentSession. See services/sessionService.ts's own comment.
    const updated = await getIdentityById(identity.id, dataAdapterMode);
    if (updated) await refreshSessionPasswordVersion(exceptSessionId, updated.passwordVersion, dataAdapterMode);
  }

  return NextResponse.json({ ok: true, signedOutEverywhere: exceptSessionId === undefined });
}
