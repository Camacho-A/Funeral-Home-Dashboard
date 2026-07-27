import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { resetPasswordWithToken } from '@/services/passwordService';
import { revokeAllSessionsForIdentity } from '@/services/sessionService';

const ERROR_STATUS: Record<string, number> = {
  invalid_token: 400,
  expired_token: 400,
  already_used: 400,
};

/**
 * Phase 21 (Identity, Authentication & Session Management). Completes a
 * forgot-password flow. On success, explicitly revokes every
 * `IdentitySession` registry row for this identity — not strictly required
 * for security (every existing session's `passwordVersionAtIssue` already
 * mismatches the identity's freshly-bumped `passwordVersion`, so
 * lib/auth/resolveIdentitySession.ts would reject them on their very next
 * use regardless), but without this, a session revoked only "logically"
 * would keep appearing in "Manage Sessions" as active until someone
 * actually tried to use it — this keeps that list honest immediately.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { token, newPassword } = parsed.body;

  if (typeof token !== 'string' || token.trim().length === 0) {
    return NextResponse.json({ error: 'token is required.' }, { status: 400 });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return NextResponse.json({ error: 'newPassword must be at least 8 characters.' }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const result = await resetPasswordWithToken(token, newPassword, dataAdapterMode);

  if (!result.success) {
    return NextResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: ERROR_STATUS[result.reason] ?? 400 });
  }

  await revokeAllSessionsForIdentity(result.identityId, dataAdapterMode);
  return NextResponse.json({ ok: true });
}
