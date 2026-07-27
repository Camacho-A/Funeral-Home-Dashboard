import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { CaseSearchProvider } from '@/hooks/useCaseSearch';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { getSession, clearSession } from '@/lib/auth/session';
import { resolveAuthorizationContext } from '@/lib/auth/authorize';
import { resolveIdentitySession } from '@/lib/auth/resolveIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
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
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const dataAdapterMode = getDataAdapterMode();
  const authAdapterMode = getAuthAdapterMode();

  if (session.user.source === 'identity') {
    const resolved = await resolveIdentitySession(session, dataAdapterMode);
    if (!resolved.valid) {
      await clearSession();
      redirect(`/login?error=${resolved.reason}`);
    }

    const membershipResult = await resolveMembershipAuthorizationContext(resolved.identitySession, dataAdapterMode);
    if (!membershipResult.granted) {
      redirect(`/login?error=${membershipResult.reason}`);
    }

    return (
      <CaseSearchProvider>
        <OrganizationProvider organizationId={membershipResult.context.organizationId} dataAdapterMode={dataAdapterMode}>
          <AppShell authAdapterMode={authAdapterMode}>{children}</AppShell>
        </OrganizationProvider>
      </CaseSearchProvider>
    );
  }

  const result = resolveAuthorizationContext(session);
  if (!result.granted) {
    redirect(`/login?error=${result.reason}`);
  }

  return (
    <CaseSearchProvider>
      <OrganizationProvider organizationId={result.context.organizationId} dataAdapterMode={dataAdapterMode}>
        <AppShell authAdapterMode={authAdapterMode}>{children}</AppShell>
      </OrganizationProvider>
    </CaseSearchProvider>
  );
}
