'use client';

import { useState } from 'react';
import Link from 'next/link';
import { isBottleneckStage } from '@/domain/cases/stages';
import { formatDaysAgo } from '@/utils/format';
import { toDisplayTitleCase } from '@/utils/string';
import styles from './CasesByStagePanel.module.css';

export type StageBarRow = { label: string; count: number | null; pct: number; displayStage: number };

/** The handful of fields the Stage Preview row needs — case number,
    decedent name, and a recency signal. No `updatedAt`/`lastUpdated`
    timestamp exists anywhere on Case/CaseViewModel (confirmed against
    types/case.ts and types/caseViewModel.ts) — `daysWaitingInStage` is
    the one real, already-computed recency field (days since the case
    entered its current stage), so that's what renders here, through the
    same `formatDaysAgo` helper NeedsAttentionPanel-adjacent timeline UI
    already uses ("Today"/"Yesterday"/"N days ago"). This is a deliberate,
    honest substitution for the approved design's "43 min ago"-style
    copy, which would require a timestamp this app doesn't persist. */
export type StagePreviewCase = { id: string; caseNumber: string; decedentName: string; daysWaitingInStage: number };

/**
 * SOLIS true redesign, Phase 1 (2026-10). Cases by Stage's own Stage
 * Preview accordion — the one explicitly approved Dashboard interaction
 * change in this phase. Clicking a stage row expands an inline preview of
 * the cases already in that stage (case number, name, days-in-stage)
 * directly beneath the row; only one stage is open at a time; clicking
 * the open stage again collapses it. This is purely local presentation
 * state (`openStage`), never persisted anywhere.
 *
 * `casesByStage` is pre-grouped by the caller (app/(portal)/dashboard/
 * page.tsx) from the SAME `allViewModels` array already fetched there for
 * NeedsAttentionPanel/the KPI strip — no new network request, no N+1 per
 * stage. `rows`' own `count` (from the server-side counts endpoint,
 * Phase 2) remains the number shown and the bar's own presence signal;
 * `casesByStage` only supplies the expanded preview's row contents. A org
 * with more cases than `allViewModels`' own fetch window would see a
 * preview that can under-count relative to the header number — an
 * accepted, reported tradeoff (see this phase's own report), the same one
 * already documented for NeedsAttentionPanel's identical data source.
 *
 * Still a pure navigation hub otherwise: "All Cases" and "Open full stage
 * list →" are real links into the existing `/cases` route (optionally
 * `?stage=<label>`), unchanged from before this phase. Clicking a preview
 * case opens the existing Case Detail route exactly as today.
 */
export function CasesByStagePanel({
  allCasesCount,
  rows,
  casesByStage,
}: {
  allCasesCount: number | null;
  rows: StageBarRow[];
  casesByStage: Record<string, StagePreviewCase[]>;
}) {
  const [openStage, setOpenStage] = useState<string | null>(null);
  const nonZeroStages = rows.filter((row) => (row.count ?? 0) > 0);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>Cases by stage</div>
        <Link href="/cases" className={styles.allCasesLink}>
          All cases{allCasesCount !== null ? ` · ${allCasesCount}` : ''}
        </Link>
      </div>

      {/* A compact presence overview — one equal-width segment per stage
          that currently has cases, not a precise proportion bar (the
          per-stage number to the right of each row below is the exact
          count; this is a glanceable "where is the work" strip, matching
          the approved design's own compact pipeline treatment). */}
      <div className={styles.overviewBar}>
        {nonZeroStages.length === 0 ? (
          <div className={styles.overviewBarEmpty} />
        ) : (
          nonZeroStages.map((row) => (
            <div
              key={row.label}
              className={isBottleneckStage(row.displayStage) ? styles.overviewSegmentDanger : styles.overviewSegment}
            />
          ))
        )}
      </div>

      <div className={styles.rows}>
        {rows.map((row) => {
          const isOpen = openStage === row.label;
          const count = row.count ?? 0;
          const cases = casesByStage[row.label] ?? [];
          const isDanger = isBottleneckStage(row.displayStage) && count > 0;
          const previewId = `stage-preview-${row.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

          return (
            <div key={row.label}>
              <button
                type="button"
                className={`${styles.row} ${isOpen ? styles.rowOpen : ''}`}
                aria-expanded={isOpen}
                aria-controls={previewId}
                onClick={() => setOpenStage(isOpen ? null : row.label)}
              >
                <span className={styles.dot} data-variant={count === 0 ? 'empty' : isDanger ? 'danger' : 'active'} />
                <span className={`${styles.label} ${count === 0 ? styles.labelMuted : ''}`}>{row.label}</span>
                <span className={`${styles.count} ${count === 0 ? styles.labelMuted : ''}`}>{row.count ?? '—'}</span>
                <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} aria-hidden="true">
                  ›
                </span>
              </button>
              {isOpen && (
                <div id={previewId} className={styles.preview}>
                  {cases.length === 0 && <div className={styles.empty}>No cases in this stage</div>}
                  {cases.map((c) => (
                    <Link key={c.id} href={`/cases/${c.id}`} className={styles.previewRow}>
                      <span className={styles.previewCaseNo}>{c.caseNumber}</span>
                      <span className={styles.previewName}>{toDisplayTitleCase(c.decedentName)}</span>
                      <span className={styles.previewUpdated}>{formatDaysAgo(c.daysWaitingInStage)}</span>
                    </Link>
                  ))}
                  <Link href={{ pathname: '/cases', query: { stage: row.label } }} className={styles.openFull}>
                    Open full stage list →
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
