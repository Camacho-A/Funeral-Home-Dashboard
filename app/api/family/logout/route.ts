import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getFamilySession, clearFamilySession } from '@/lib/auth/familySession';
import { revokeSession } from '@/services/portal/portalSessionService';

/**
 * Phase 29 (Family Portal & External Collaboration). Revokes the
 * server-side `PortalSession` registry row, not just the browser's
 * cookie — otherwise a copied/replayed token would remain valid until it
 * naturally expired, mirroring `app/login/actions.ts`'s own `logoutAction`
 * precedent exactly.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const session = await getFamilySession();
  if (session) {
    await revokeSession(session.sessionId, getDataAdapterMode());
  }
  await clearFamilySession();

  return NextResponse.json({ ok: true });
}
