import type { StepperStage } from './StageStepper';

/**
 * SOLIS Final Phase §8.1 — a presentational stage-progression list above
 * CaseWorkflowRepairPanel on the Workflow tab. All props are existing
 * view-model values the page already computes for CaseHeader/ChecklistCard
 * (`stepperStages`, `viewModel.daysWaitingInStage`, `viewModel.slaTargetLabel`,
 * `viewModel.checklist`) — no new derivation, no new data.
 *
 * `onViewStage` reuses the exact read-only past-stage view CaseHeader's
 * `onStepClick` already opens (`setViewingDisplayStage`/`setActiveTab` in
 * page.tsx) — clicking "View checklist" here just jumps to Overview.
 * Checklist toggling stays Overview-only; nothing here can check an item
 * off (the `.sx-wf-item` boxes are read-only, matching the "Read-only
 * here" help text below them).
 */
export function WorkflowStageOverview({
  stages,
  daysWaitingInStage,
  slaTargetLabel,
  currentChecklist,
  onViewStage,
}: {
  stages: StepperStage[];
  daysWaitingInStage: number;
  slaTargetLabel: string;
  currentChecklist: { label: string; done: boolean }[];
  onViewStage: (index: number) => void;
}) {
  const currentIndex = stages.findIndex((s) => s.current);
  const doneCount = currentChecklist.filter((item) => item.done).length;
  const total = currentChecklist.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="sx-wf">
      <h2 className="sx-section-title">
        Stage progression
        <span className="sx-section-meta">
          Step {currentIndex + 1} of {stages.length}
        </span>
      </h2>
      <ol className="sx-wf-list">
        {stages.map((stage, index) => {
          const state = stage.done ? 'done' : stage.current ? 'current' : 'upcoming';
          return (
            <li key={stage.label} className="sx-wf-stage" data-state={state} aria-current={stage.current ? 'step' : undefined}>
              <span className="sx-wf-dot" aria-hidden="true">
                {stage.done ? '✓' : index + 1}
              </span>
              <div>
                <div className="sx-wf-name">{stage.label}</div>
                <div className="sx-wf-sub">
                  {stage.done
                    ? 'Complete'
                    : stage.current
                      ? `Current stage · Day ${daysWaitingInStage} · target ${slaTargetLabel}`
                      : 'Not reached'}
                </div>
                {stage.current && (
                  <div className="sx-wf-current">
                    <div className="sx-wf-progress">
                      <span>
                        {doneCount} of {total} complete
                      </span>
                      <span className="sx-wf-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}>
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    </div>
                    {currentChecklist.map((item) => (
                      <div key={item.label} className="sx-wf-item" data-done={item.done || undefined}>
                        <span className="sx-wf-box" aria-hidden="true">
                          {item.done ? '✓' : ''}
                        </span>
                        <span>{item.label}</span>
                        <span className="sr-only">{item.done ? 'Done' : 'Not done'}</span>
                      </div>
                    ))}
                    <div className="sx-help" style={{ marginTop: 8 }}>
                      Read-only here. Check items off in Overview → Next step.
                    </div>
                  </div>
                )}
              </div>
              {stage.done && (
                <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" style={{ color: 'var(--sx-link)' }} onClick={() => onViewStage(index)}>
                  View checklist
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
