import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { listActiveSessionsForIdentity } from '@/services/sessionService';

/**
 * Phase 21 (Identity, Authentication & Session Management). "View active
 * sessions (device/browser/location/last seen/remembered device)" — backs
 * the Manage Sessions UI page. Marks which row is *this* request's own
 * session (`isCurrent`) so the UI can label/disable revoking it directly
 * (use POST /api/auth/sessions/sign-out-everywhere for that instead).
 */
export async function GET() {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const sessions = await listActiveSessionsForIdentity(identity.id, dataAdapterMode);
  return NextResponse.json({
    sessions: sessions.map((s) => ({ ...s, isCurrent: s.id === identitySession.id })),
  });
}
