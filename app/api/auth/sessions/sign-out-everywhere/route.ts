import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { revokeAllSessionsForIdentity } from '@/services/sessionService';
import { clearSession } from '@/lib/auth/session';

/**
 * Phase 21 (Identity, Authentication & Session Management). "Sign out
 * everywhere" — revokes every session for this identity, including the
 * one making this very request, then clears this browser's own cookie
 * immediately (rather than leaving it to be rejected on the next
 * request). Distinct from DELETE /api/auth/sessions/[sessionId], which
 * only ever revokes one specific device.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, dataAdapterMode } = access;

  const revokedCount = await revokeAllSessionsForIdentity(identity.id, dataAdapterMode);
  await clearSession();

  return NextResponse.json({ ok: true, revokedCount });
}
