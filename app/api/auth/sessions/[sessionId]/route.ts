import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { getSessionById, revokeSession } from '@/services/sessionService';
import { clearSession } from '@/lib/auth/session';

/**
 * Phase 21 (Identity, Authentication & Session Management). Revokes one
 * specific session — "Revoke session"/"Sign out other devices" (called
 * once per device to remove) from the Manage Sessions UI. Always
 * re-fetches the target row and checks `identityId` matches the caller's
 * own before revoking it — the path param is untrusted input, exactly
 * like every other route's client-supplied id; a caller can never revoke
 * a session belonging to a different identity by guessing its id.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const { sessionId } = await params;
  const target = await getSessionById(sessionId, dataAdapterMode);
  if (!target || target.identityId !== identity.id) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }

  await revokeSession(sessionId, dataAdapterMode);

  // Revoking one's own current session is "sign out" for this device —
  // clear its cookie immediately rather than leaving a now-invalid one.
  if (sessionId === identitySession.id) {
    await clearSession();
  }

  return NextResponse.json({ ok: true });
}
