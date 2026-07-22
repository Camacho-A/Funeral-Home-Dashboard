import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { CaseSearchProvider } from '@/hooks/useCaseSearch';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { getSession } from '@/lib/auth/session';
import { resolveAuthorizationContext } from '@/lib/auth/authorize';
import { getDataAdapterMode } from '@/lib/env';

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
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const result = resolveAuthorizationContext(session);
  if (!result.granted) {
    redirect(`/login?error=${result.reason}`);
  }

  const dataAdapterMode = getDataAdapterMode();

  return (
    <CaseSearchProvider>
      <OrganizationProvider organizationId={result.context.organizationId} dataAdapterMode={dataAdapterMode}>
        <AppShell>{children}</AppShell>
      </OrganizationProvider>
    </CaseSearchProvider>
  );
}
