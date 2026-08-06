import { redirect } from 'next/navigation';
import { getFamilySession, clearFamilySession } from '@/lib/auth/familySession';
import { resolveFamilySession } from '@/lib/auth/resolveFamilySession';
import { getDataAdapterMode } from '@/lib/env';
import { FamilyShell } from '@/components/family/FamilyShell';

/**
 * Phase 29 (Family Portal & External Collaboration). Mirrors
 * `app/(portal)/layout.tsx`'s own defense-in-depth reasoning exactly:
 * `middleware.ts` already redirects an unauthenticated `/family/*` request
 * away, but this server-side check is a second, independent gate, not the
 * only one. Uses `resolveFamilySession` directly (not
 * `requireFamilySession`, which is shaped for Route Handlers and returns a
 * `NextResponse`, not something a layout can `redirect()` with) — the
 * exact same relationship `app/(portal)/layout.tsx` has with
 * `resolveIdentitySession` vs. `requireIdentitySession`.
 *
 * A session that fails to resolve (revoked/expired/portal user disabled)
 * is treated exactly like no session at all: the stale cookie is cleared
 * and the visitor is sent back to `/family/login`, never left retrying
 * with it.
 */
export default async function FamilyPortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getFamilySession();
  if (!session) {
    redirect('/family/login');
  }

  const dataAdapterMode = getDataAdapterMode();
  const resolved = await resolveFamilySession(session, dataAdapterMode);
  if (!resolved.valid) {
    await clearFamilySession();
    redirect('/family/login');
  }

  return <FamilyShell displayName={resolved.portalUser.displayName}>{children}</FamilyShell>;
}
