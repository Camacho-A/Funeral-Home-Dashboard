'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { OrganizationProvider, useOrganization } from '@/hooks/useOrganization';
import { useCases } from '@/hooks/useCases';
import { usePortfolio } from '@/hooks/usePortfolio';
import { organizationCaseHref } from './organizationLinks';
import styles from './CombinedDashboard.module.css';

type Hit = { organizationId: string; caseId: string; caseNumber: string; decedentName: string };
const MAX_PER_ORGANIZATION = 25;

/**
 * Unified portal (Phase 5N, 2026-11): case search across the person's
 * organizations. Each organization is searched separately, by the server,
 * with the person's membership there (useCases inside that organization's
 * provider); results are labelled with their funeral home and open at
 * `/o/{organization}/cases/{id}`. A case number is only unique within its
 * organization, so the label is part of every result.
 */
export function CombinedCaseSearch({ organizationIds }: { organizationIds: string[] }) {
  const { dataAdapterMode } = useOrganization();
  const { organizations } = usePortfolio();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Record<string, Hit[]>>({});
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const onHits = useCallback(
    (organizationId: string, list: Hit[]) => setHits((prev) => (prev[organizationId] && JSON.stringify(prev[organizationId]) === JSON.stringify(list) ? prev : { ...prev, [organizationId]: list })),
    [],
  );
  const nameOf = useMemo(() => new Map(organizations.map((o) => [o.organizationId, o.displayName])), [organizations]);
  const results = query.length >= 2 ? organizationIds.flatMap((id) => hits[id] ?? []) : [];

  return (
    <section className={styles.card} data-testid="combined-search">
      <label className={styles.cardTitle} htmlFor="combined-case-search">
        Search cases in all authorized organizations
      </label>
      <input
        id="combined-case-search"
        className={styles.searchInput}
        type="search"
        placeholder="Name, case number or phone"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
      {query.length >= 2 &&
        organizationIds.map((id) => (
          <OrganizationProvider key={id} organizationId={id} dataAdapterMode={dataAdapterMode}>
            <SearchSlice query={query} onHits={onHits} />
          </OrganizationProvider>
        ))}
      {query.length >= 2 && (
        <ul className={styles.rows} data-testid="combined-search-results">
          {results.length === 0 && <li className={styles.note}>No matching cases.</li>}
          {results.map((r) => (
            <li key={`${r.organizationId}:${r.caseId}`}>
              <Link className={styles.row} href={organizationCaseHref(r.organizationId, r.caseId)}>
                <span className={styles.orgLabel} data-testid="organization-label">
                  {nameOf.get(r.organizationId) ?? r.organizationId}
                </span>
                <span className={styles.caseNumber}>{r.caseNumber}</span>
                <span className={styles.name}>{r.decedentName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SearchSlice({ query, onHits }: { query: string; onHits: (organizationId: string, hits: Hit[]) => void }) {
  const { organizationId } = useOrganization();
  const { data } = useCases({ searchQuery: query });
  useEffect(() => {
    onHits(
      organizationId,
      (data ?? []).slice(0, MAX_PER_ORGANIZATION).map((c) => ({ organizationId, caseId: c.id, caseNumber: c.caseNumber, decedentName: c.decedentName })),
    );
  }, [data, organizationId, onHits]);
  return null;
}
