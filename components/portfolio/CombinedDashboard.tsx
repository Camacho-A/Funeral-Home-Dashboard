'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { OrganizationProvider, useOrganization } from '@/hooks/useOrganization';
import { usePortfolio } from '@/hooks/usePortfolio';
import { OrganizationSlice, type CombinedCaseRow, type OrganizationSliceData } from './OrganizationSlice';
import { CombinedCaseSearch } from './CombinedCaseSearch';
import { OrganizationFilter } from './OrganizationFilter';
import { organizationCaseHref } from './organizationLinks';
import styles from './CombinedDashboard.module.css';

/**
 * Unified portal (Phase 5N, 2026-11): the Dashboard for "All authorized
 * organizations". Viewing only. Each organization's part comes from its
 * own slice (asked of the server separately, with the person's role in
 * that organization); lists are merged and every row names its funeral
 * home; stages stay per organization because the homes' workflows differ.
 * Opening a row goes to `/o/{organization}/cases/{id}`.
 */
export function CombinedDashboard() {
  const { dataAdapterMode } = useOrganization();
  const { organizations } = usePortfolio();
  const [filter, setFilter] = useState<string | null>(null);
  const [slices, setSlices] = useState<Record<string, OrganizationSliceData>>({});
  // Each slice reports whenever its hooks re-render; only a real change updates the page.
  const onData = useCallback(
    (data: OrganizationSliceData) =>
      setSlices((prev) => (prev[data.organizationId] && JSON.stringify(prev[data.organizationId]) === JSON.stringify(data) ? prev : { ...prev, [data.organizationId]: data })),
    [],
  );
  const shown = organizations.filter((o) => filter === null || o.organizationId === filter);
  const nameOf = useMemo(() => new Map(organizations.map((o) => [o.organizationId, o.displayName])), [organizations]);
  const merged = (pick: (s: OrganizationSliceData) => CombinedCaseRow[] | null, order: 'asc' | 'desc') =>
    shown
      .flatMap((o) => pick(slices[o.organizationId] ?? emptySlice(o.organizationId)) ?? [])
      .sort((a, b) => (order === 'asc' ? a.sortKey.localeCompare(b.sortKey) : b.sortKey.localeCompare(a.sortKey)));
  const recentHidden = shown.filter((o) => slices[o.organizationId]?.loaded && slices[o.organizationId]?.recent === null);

  return (
    <div className={styles.page} data-testid="combined-dashboard">
      <header className={styles.header}>
        <h1 className={styles.title}>All authorized organizations</h1>
        <p className={styles.subtitle}>Viewing only. Open a case, or choose one organization in the sidebar, to make changes.</p>
        <OrganizationFilter value={filter} onChange={setFilter} />
      </header>

      {shown.map((o) => (
        <OrganizationProvider key={o.organizationId} organizationId={o.organizationId} dataAdapterMode={dataAdapterMode}>
          <OrganizationSlice onData={onData} />
        </OrganizationProvider>
      ))}

      <CombinedCaseSearch organizationIds={shown.map((o) => o.organizationId)} />

      <div className={styles.grid}>
        <CaseListCard title="Cases needing attention" testId="combined-attention" rows={merged((s) => s.attention, 'asc')} nameOf={nameOf} empty="Nothing needs attention." />
        <CaseListCard title="Upcoming services" testId="combined-upcoming" rows={merged((s) => s.upcoming, 'asc')} nameOf={nameOf} empty="No upcoming services." />
        <CaseListCard
          title="Recently updated cases"
          testId="combined-recent"
          rows={merged((s) => s.recent, 'desc').slice(0, 12)}
          nameOf={nameOf}
          empty="No recent updates."
          note={recentHidden.length > 0 ? `Not shown for ${recentHidden.map((o) => o.displayName).join(', ')}: your role there cannot view activity.` : undefined}
          formatDetail={(d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        />
      </div>

      <section className={styles.card} data-testid="combined-stages">
        <h2 className={styles.cardTitle}>Cases by stage</h2>
        <p className={styles.note}>Each funeral home has its own workflow, so stages are shown separately.</p>
        <div className={styles.stageColumns}>
          {shown.map((o) => {
            const stages = slices[o.organizationId]?.stages;
            return (
              <div key={o.organizationId} className={styles.stageColumn} data-testid={`combined-stages-${o.organizationId}`}>
                <h3 className={styles.stageOrg}>
                  {o.displayName}
                  <span className={styles.stageTotal}>{stages?.total ?? '—'} cases</span>
                </h3>
                <ul className={styles.stageList}>
                  {(stages?.rows ?? []).map((row) => (
                    <li key={row.label} className={styles.stageRow}>
                      <span>{row.label}</span>
                      <span className={styles.stageCount}>{row.count ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function emptySlice(organizationId: string): OrganizationSliceData {
  return { organizationId, loaded: false, attention: [], recent: [], upcoming: [], stages: { rows: [], total: null } };
}

function CaseListCard({
  title,
  testId,
  rows,
  nameOf,
  empty,
  note,
  formatDetail = (d) => d,
}: {
  title: string;
  testId: string;
  rows: CombinedCaseRow[];
  nameOf: Map<string, string>;
  empty: string;
  note?: string;
  formatDetail?: (detail: string) => string;
}) {
  return (
    <section className={styles.card} data-testid={testId}>
      <h2 className={styles.cardTitle}>
        {title} <span className={styles.count}>{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className={styles.note}>{empty}</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((r) => (
            <li key={`${r.organizationId}:${r.caseId}`}>
              <Link className={styles.row} href={organizationCaseHref(r.organizationId, r.caseId)}>
                <span className={styles.orgLabel} data-testid="organization-label">
                  {nameOf.get(r.organizationId) ?? r.organizationId}
                </span>
                <span className={styles.caseNumber}>{r.caseNumber}</span>
                <span className={styles.name}>{r.decedentName}</span>
                <span className={styles.detail}>{formatDetail(r.detail)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {note && <p className={styles.note}>{note}</p>}
    </section>
  );
}
