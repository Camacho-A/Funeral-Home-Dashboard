'use client';

import { useEffect, useRef, useState } from 'react';
import type { StepperStage } from './StageStepper';
import styles from './StageProgress.module.css';

/**
 * SOLIS — compact stage progress for the Case Detail header.
 * A 7-segment bar + "Step N of M · Day X". Clicking it opens a popover
 * listing every stage; reached stages call the SAME `onStepClick(index)`
 * the old StageStepper used (read-only past checklist / back to current).
 * Uses the existing StepperStage data — no new data or logic.
 */
export function StageProgress({
  stages,
  daysWaitingInStage,
  onStepClick,
}: {
  stages: StepperStage[];
  daysWaitingInStage: number;
  onStepClick: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentIndex = Math.max(0, stages.findIndex((s) => s.current));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Workflow progress: step ${currentIndex + 1} of ${stages.length}. Show all stages`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.bar} aria-hidden="true">
          {stages.map((s) => (
            <span
              key={s.label}
              className={`${styles.segment} ${s.done ? styles.segmentDone : s.current ? styles.segmentCurrent : styles.segmentUpcoming}`}
            />
          ))}
        </span>
        <span className={styles.text}>
          Step {currentIndex + 1} of {stages.length} · Day {daysWaitingInStage}
        </span>
        <span className={styles.chevron} aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <ol className={styles.popover} aria-label="Workflow stages">
          {stages.map((s, index) => (
            <li key={s.label}>
              <button
                type="button"
                className={`${styles.item} ${s.current ? styles.itemCurrent : ''}`}
                disabled={!s.viewable}
                aria-current={s.current ? 'step' : undefined}
                onClick={() => {
                  onStepClick(index);
                  setOpen(false);
                }}
              >
                <span className={`${styles.dot} ${s.done ? styles.dotDone : s.current ? styles.dotCurrent : styles.dotUpcoming}`}>
                  {s.done ? '✓' : index + 1}
                </span>
                <span className={styles.itemLabel}>{s.label}</span>
                <span className={styles.itemHint}>{s.done ? 'View' : s.current ? 'Current' : ''}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
