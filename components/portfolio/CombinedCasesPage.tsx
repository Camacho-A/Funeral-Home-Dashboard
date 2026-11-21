'use client';

import { useState } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { CombinedCaseSearch } from './CombinedCaseSearch';
import { OrganizationFilter } from './OrganizationFilter';
import styles from './CombinedDashboard.module.css';

/** Unified portal (Phase 5N): the Cases page in "All authorized organizations" — search with a funeral-home filter. */
export function CombinedCasesPage() {
  const { organizations } = usePortfolio();
  const [filter, setFilter] = useState<string | null>(null);
  const ids = organizations.map((o) => o.organizationId).filter((id) => filter === null || id === filter);
  return (
    <div className={styles.page} data-testid="combined-cases">
      <header className={styles.header}>
        <h1 className={styles.title}>Cases — all authorized organizations</h1>
        <p className={styles.subtitle}>Stage lists belong to each funeral home&rsquo;s own workflow: choose one organization in the sidebar to browse them.</p>
        <OrganizationFilter value={filter} onChange={setFilter} />
      </header>
      <CombinedCaseSearch organizationIds={ids} />
    </div>
  );
}
