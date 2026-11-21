import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { resolveIdentitySession } from '@/lib/auth/resolveIdentitySession';
import { listMembershipsForIdentity, isActiveMembership } from '@/services/membershipService';
import { getOrganization } from '@/services/organizationProvisioningService';
import { filterToDeploymentOrganizations } from '@/lib/auth/deploymentOrganizations';
import { getDataAdapterMode } from '@/lib/env';
import { chooseOrganization } from './actions';

/**
 * Unified portal (Phase 5N, 2026-11). A person who belongs to more than one
 * organization this deployment serves picks where to start after signing in
 * (instead of the old "contact an administrator" dead end). Only their own
 * active memberships are listed, from the server; the choice is re-checked
 * by the server before it is used. They can switch, or view all, from the
 * sidebar afterwards.
 */
export default async function ChooseOrganizationPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession();
  if (!session || session.user.source !== 'identity') redirect('/login');
  const dataAdapterMode = getDataAdapterMode();
  const resolved = await resolveIdentitySession(session, dataAdapterMode);
  if (!resolved.valid) redirect('/login');
  const memberships = filterToDeploymentOrganizations((await listMembershipsForIdentity(resolved.identitySession.identityId, dataAdapterMode)).filter(isActiveMembership), (m) => m.organizationId);
  if (memberships.length === 0) redirect('/login?error=no_active_membership');
  const organizations = await Promise.all(memberships.map(async (m) => ({ organizationId: m.organizationId, name: (await getOrganization(m.organizationId, dataAdapterMode))?.name ?? m.organizationId })));
  const { error } = await searchParams;

  return (
    <main id="main-content" style={{ maxWidth: 440, margin: '64px auto', padding: '0 16px', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Where would you like to start?</h1>
      <p style={{ margin: '0 0 20px', color: 'var(--color-text-secondary)' }}>You work with more than one funeral home. You can switch, or view all of them together, from the sidebar at any time.</p>
      {error && (
        <p role="alert" className="sx-form-banner sx-form-banner-error">
          That organization is not available to you.
        </p>
      )}
      <form action={chooseOrganization} style={{ display: 'grid', gap: 10 }} data-testid="choose-organization">
        {organizations.map((o) => (
          <button key={o.organizationId} type="submit" name="organizationId" value={o.organizationId} className="sx-btn sx-btn-secondary" style={{ minHeight: 48, justifyContent: 'flex-start', textAlign: 'left' }}>
            {o.name}
          </button>
        ))}
      </form>
    </main>
  );
}
