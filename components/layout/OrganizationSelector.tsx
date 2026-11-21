'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePortfolio } from '@/hooks/usePortfolio';
import { switchOrganization } from '@/lib/identityAuthClient';
import styles from './OrganizationSelector.module.css';

export const ALL_ORGANIZATIONS_VALUE = '__all_authorized__';

/**
 * Unified portal (Phase 5N, 2026-11): the prominent organization selector
 * at the top of the sidebar, for people who belong to more than one
 * organization. Lists only organizations the SERVER says they belong to.
 *
 * - "All authorized organizations": combined viewing and reporting only
 *   (Dashboard, case search). Nothing is switched on the server.
 * - One organization: asks the server to make it the working organization
 *   (POST /api/auth/switch-organization re-checks the membership), then
 *   reloads — every page and every write then runs in it.
 */
export function OrganizationSelector({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const { organizations, isMultiOrganization, combined, setCombined, workingOrganizationId } = usePortfolio();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isMultiOrganization) return null;

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    setError(null);
    if (value === ALL_ORGANIZATIONS_VALUE) {
      setCombined(true);
      onNavigate?.();
      router.push('/dashboard');
      return;
    }
    setCombined(false);
    if (value === workingOrganizationId) return;
    setPending(true);
    try {
      await switchOrganization(value);
      onNavigate?.();
      router.refresh();
    } catch {
      setError('Could not switch organization. Nothing was changed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.selector} data-testid="organization-selector">
      <label className={styles.label} htmlFor="organization-selector">
        Organization
      </label>
      <select id="organization-selector" className={styles.select} value={combined ? ALL_ORGANIZATIONS_VALUE : workingOrganizationId} onChange={handleChange} disabled={pending}>
        <option value={ALL_ORGANIZATIONS_VALUE}>All authorized organizations</option>
        {organizations.map((org) => (
          <option key={org.organizationId} value={org.organizationId}>
            {org.displayName}
          </option>
        ))}
      </select>
      {combined && <p className={styles.hint}>Viewing only. Choose one organization to create or change anything.</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
