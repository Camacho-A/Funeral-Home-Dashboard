'use client';

import { useRouter } from 'next/navigation';
import { useMyMemberships, useSwitchOrganization } from '@/hooks/useMyMemberships';
import styles from './OrganizationSwitcher.module.css';

/**
 * Phase 21 (Identity, Authentication & Session Management). "Users with
 * multiple memberships switch without logging out" — renders nothing for
 * an identity with zero or one active membership (the ordinary case;
 * app/(portal)/layout.tsx's resolveMembershipAuthorizationContext already
 * auto-selects the one membership there is, so a switcher would have
 * nothing useful to offer). On selection, calls
 * POST /api/auth/switch-organization (which independently re-verifies the
 * membership server-side — this component never grants access itself,
 * only requests a switch) then router.refresh() so
 * app/(portal)/layout.tsx re-resolves organizationId from the now-updated
 * IdentitySession row rather than this component guessing at the new
 * value itself.
 */
export function OrganizationSwitcher() {
  const router = useRouter();
  const membershipsQuery = useMyMemberships();
  const switchOrganization = useSwitchOrganization();

  const organizations = membershipsQuery.data ?? [];
  if (organizations.length <= 1) return null;

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    await switchOrganization.mutateAsync(event.target.value);
    router.refresh();
  }

  return (
    <select
      className={styles.select}
      value={organizations.find((o) => o.isCurrent)?.organizationId ?? ''}
      onChange={handleChange}
      disabled={switchOrganization.isPending}
      aria-label="Switch organization"
    >
      {organizations.map((org) => (
        <option key={org.organizationId} value={org.organizationId}>
          {org.displayName}
        </option>
      ))}
    </select>
  );
}
