import styles from './StageStepper.module.css';

export type StepperStage = {
  label: string;
  done: boolean;
  current: boolean;
  /** A stage is viewable (clickable to see its checklist read-only) only if
      the case has already reached it — ported from design/support.js's
      `viewable = idx <= selected.displayStage`. */
  viewable: boolean;
};

/**
 * Purely presentational: `stages` (done/current/viewable per stage) is
 * computed by the page from CaseViewModel.displayStage — the stepper's own
 * dots never change based on which past stage is being *viewed* read-only
 * (that only affects ChecklistCard); clicking a viewable dot just reports
 * the index back via onStepClick.
 */
export function StageStepper({
  stages,
  onStepClick,
}: {
  stages: StepperStage[];
  onStepClick: (index: number) => void;
}) {
  return (
    <div className={styles.stepper}>
      {stages.map((stage, index) => (
        <div key={stage.label} className={styles.stage}>
          <button
            type="button"
            className={`${styles.stepButton} ${stage.viewable ? styles.stepButtonViewable : styles.stepButtonDisabled}`}
            onClick={stage.viewable ? () => onStepClick(index) : undefined}
            disabled={!stage.viewable}
          >
            <span
              className={`${styles.dot} ${stage.done ? styles.dotDone : stage.current ? styles.dotCurrent : styles.dotUpcoming}`}
            >
              {stage.done ? '✓' : index + 1}
            </span>
            <span className={`${styles.label} ${stage.current ? styles.labelCurrent : styles.labelOther}`}>
              {stage.label}
            </span>
          </button>
          {index < stages.length - 1 && (
            <div className={`${styles.connector} ${stage.done ? styles.connectorDone : styles.connectorUpcoming}`} />
          )}
        </div>
      ))}
    </div>
  );
}
