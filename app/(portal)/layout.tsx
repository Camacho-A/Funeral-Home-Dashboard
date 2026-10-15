import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { ScopedQueryClientProvider } from '@/components/providers/ScopedQueryClientProvider';
import { CaseSearchProvider } from '@/hooks/useCaseSearch';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { SessionProvider } from '@/hooks/useSession';
import type { Session } from '@/types/session';
import { getSession, clearSessionPath } from '@/lib/auth/session';
import { resolveAuthorizationContext, isNonIdentityAuthorizationPermitted } from '@/lib/auth/authorize';
import { resolveIdentitySession } from '@/lib/auth/resolveIdentitySession';
import { resolveMembershipAuthorizationContext, prefetchMembershipsForSession } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode, getAuthAdapterMode } from '@/lib/env';

/**
 * Phase 13 (Authentication & Organizations). Middleware (middleware.ts)
 * already redirects unauthenticated requests away from every route this
 * layout wraps — the session check here is deliberate defense-in-depth,
 * not the only gate, per "do not use client-side route guards as the
 * only security boundary": server-side protection exists at two
 * independent points, not one.
 *
 * The organizationId every page/component below sees via useOrganization()
 * comes only from resolveAuthorizationContext's validated membership
 * lookup — never from a URL, a cookie value read directly, or any other
 * browser-supplied input. A user with no active membership, or more than
 * one with none selected, is sent back to login rather than shown a
 * partially-working portal — this phase doesn't build an
 * organization-selection UI (see docs/AUTHENTICATION.md).
 *
 * Phase 21 (Identity, Authentication & Session Management) adds a second
 * branch for `session.user.source === 'identity'`. Middleware only ever
 * checks the signed cookie's signature/expiry (see middleware.ts's own
 * comment on why it's kept Wix/Node-crypto-free) — the deeper checks a
 * revocable, server-registry-backed session needs (revoked? expired past
 * its sliding window? issued under a password that's since changed?) run
 * here instead, at the same defense-in-depth layer that already resolves
 * organization membership. A session that fails resolveIdentitySession is
 * treated exactly like no session at all: the stale cookie is cleared and
 * the user is sent back to login, never left retrying with it.
 *
 * 2026-10: "cleared" happens in the GET /api/auth/clear-session Route
 * Handler, never here — a Server Component may not modify cookies during
 * render (Next.js throws). This layout only ever READS the cookie and
 * redirects. The same handler discards a mock/wix-login session presented
 * to a deployment on real Wix data (isNonIdentityAuthorizationPermitted):
 * those sessions authorize against in-repo mock memberships, so they fail
 * closed rather than ever being trusted against live tenant data.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const dataAdapterMode = getDataAdapterMode();
  const authAdapterMode = getAuthAdapterMode();

  if (session.user.source !== 'identity' && !isNonIdentityAuthorizationPermitted()) {
    redirect(clearSessionPath('auth_adapter_not_allowed'));
  }

  if (session.user.source === 'identity') {
    // Performance phase 1 (2026-10): memberships are read alongside the
    // session check; they are only used if that check passes.
    const prefetched = prefetchMembershipsForSession(session.user.id, dataAdapterMode);
    const resolved = await resolveIdentitySession(session, dataAdapterMode);
    if (!resolved.valid) {
      redirect(clearSessionPath(resolved.reason));
    }

    const membershipResult = await resolveMembershipAuthorizationContext(resolved.identitySession, dataAdapterMode, undefined, prefetched);
    if (!membershipResult.granted) {
      redirect(`/login?error=${membershipResult.reason}`);
    }

    const currentSession = await resolveCurrentSession(membershipResult.context, session.user.displayName, session.user.email, dataAdapterMode);

    return (
      <ScopedQueryClientProvider key={queryCacheScope(membershipResult.context)}>
        <CaseSearchProvider>
          <OrganizationProvider organizationId={membershipResult.context.organizationId} dataAdapterMode={dataAdapterMode}>
            <SessionProvider value={currentSession}>
              <AppShell authAdapterMode={authAdapterMode}>{children}</AppShell>
            </SessionProvider>
          </OrganizationProvider>
        </CaseSearchProvider>
      </ScopedQueryClientProvider>
    );
  }

  const result = resolveAuthorizationContext(session);
  if (!result.granted) {
    redirect(`/login?error=${result.reason}`);
  }

  const currentSession = await resolveCurrentSession(result.context, session.user.displayName, session.user.email, dataAdapterMode);

  return (
    <ScopedQueryClientProvider key={queryCacheScope(result.context)}>
        <CaseSearchProvider>
        <OrganizationProvider organizationId={result.context.organizationId} dataAdapterMode={dataAdapterMode}>
          <SessionProvider value={currentSession}>
            <AppShell authAdapterMode={authAdapterMode}>{children}</AppShell>
          </SessionProvider>
        </OrganizationProvider>
      </CaseSearchProvider>
      </ScopedQueryClientProvider>
  );
}

/** Performance phase 1 (2026-10): the client query cache belongs to one
    validated identity in one organization — see ScopedQueryClientProvider. */
function queryCacheScope(context: { userId: string; organizationId: string }): string {
  return `staff:${context.userId}:${context.organizationId}`;
}

/**
 * Manors go-live fix (2026-09): the one place the real client-facing
 * `Session` (`hooks/useSession.ts`) is resolved — reusing
 * `resolveStaffProfileForCaller`, the exact same function
 * `app/api/cases/route.ts` already trusts server-side for the identical
 * lookup, rather than inventing a second resolution path. `staffId` is
 * `null` when this identity/membership has no `StaffProfile` provisioned
 * yet in this organization — a real, disclosed possibility (see
 * `types/session.ts`), not an error condition on its own; `displayName`
 * always comes from the real, already-authenticated `AuthSession`, never
 * from the (possibly absent) `StaffProfile`.
 */
async function resolveCurrentSession(
  context: { userId: string; organizationId: string; role: string },
  displayName: string,
  email: string,
  dataAdapterMode: ReturnType<typeof getDataAdapterMode>,
): Promise<Session> {
  const staffProfile = await resolveStaffProfileForCaller(context, dataAdapterMode);
  return { staffId: staffProfile?.id ?? null, displayName, email };
}
