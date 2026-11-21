'use client';

import { usePortfolio } from '@/hooks/usePortfolio';
import styles from './CombinedDashboard.module.css';

/** Unified portal (Phase 5N): filter combined results by funeral home (only the person's own organizations). */
export function OrganizationFilter({ value, onChange }: { value: string | null; onChange: (organizationId: string | null) => void }) {
  const { organizations } = usePortfolio();
  const options = [{ organizationId: null as string | null, displayName: 'All' }, ...organizations];
  return (
    <div className={styles.filter} role="group" aria-label="Filter by funeral home" data-testid="organization-filter">
      {options.map((o) => (
        <button key={o.organizationId ?? 'all'} type="button" className={`${styles.chip} ${value === o.organizationId ? styles.chipActive : ''}`} aria-pressed={value === o.organizationId} onClick={() => onChange(o.organizationId)}>
          {o.displayName}
        </button>
      ))}
    </div>
  );
}
