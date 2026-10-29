import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StageStepper, stageStatusText, type StepperStage } from './StageStepper';
import { StageProgress } from './StageProgress';

/**
 * Stepper states (2026-10): passed & complete → green ✓; passed with
 * required steps unchecked → amber with the count; current → navy;
 * upcoming → grey. The count only ever comes from Manors' true
 * earlier-stage status — elsewhere it is absent and nothing changes.
 */
const STAGES: StepperStage[] = [
  { label: 'Intake & JotForm', done: true, current: false, viewable: true },
  { label: 'First Call & Payment', done: true, current: false, viewable: true, incompleteSteps: 2 },
  { label: 'DC Application', done: false, current: true, viewable: true },
  { label: 'Crematory Paperwork', done: false, current: false, viewable: false },
];

describe('stage status wording', () => {
  it('says what each state is', () => {
    expect(stageStatusText(STAGES[0])).toBe('Passed — all steps checked');
    expect(stageStatusText(STAGES[1])).toBe('Passed — 2 steps not checked');
    expect(stageStatusText({ ...STAGES[1], incompleteSteps: 1 })).toBe('Passed — 1 step not checked');
    expect(stageStatusText(STAGES[2])).toBe('Current stage');
    expect(stageStatusText(STAGES[3])).toBe('Upcoming');
    // A count on a stage not yet passed is never shown.
    expect(stageStatusText({ ...STAGES[2], incompleteSteps: 3 })).toBe('Current stage');
  });
});

describe('StageStepper', () => {
  it('shows ✓, the amber count, the current and upcoming numbers, with accessible text', () => {
    render(<StageStepper stages={STAGES} onStepClick={() => {}} />);
    const passed = screen.getByRole('button', { name: 'Intake & JotForm: Passed — all steps checked' });
    expect(passed).toHaveTextContent('✓');
    const incomplete = screen.getByRole('button', { name: 'First Call & Payment: Passed — 2 steps not checked' });
    expect(incomplete).toHaveTextContent('2');
    expect(incomplete).not.toHaveTextContent('✓');
    expect(incomplete.querySelector('span')!.className).toMatch(/dotIncomplete/);
    expect(screen.getByRole('button', { name: 'DC Application: Current stage' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Crematory Paperwork: Upcoming' })).toBeDisabled();
  });

  it('an incomplete earlier stage opens like any reached stage — the case does not move', () => {
    const onStepClick = vi.fn();
    render(<StageStepper stages={STAGES} onStepClick={onStepClick} />);
    fireEvent.click(screen.getByRole('button', { name: /First Call & Payment/ }));
    expect(onStepClick).toHaveBeenCalledWith(1);
  });

  it('without counts (every organization but Manors) every passed stage is a green ✓, as before', () => {
    render(<StageStepper stages={STAGES.map(({ incompleteSteps: _ignored, ...stage }) => stage)} onStepClick={() => {}} />);
    expect(screen.getByRole('button', { name: /First Call & Payment/ })).toHaveTextContent('✓');
  });
});

describe('StageProgress (Case Detail header)', () => {
  it('an amber segment and popover entry with "2 steps not checked"', () => {
    const onStepClick = vi.fn();
    const { container } = render(<StageProgress stages={STAGES} daysWaitingInStage={1} onStepClick={onStepClick} />);
    expect(container.querySelectorAll('[class*="segmentIncomplete"]')).toHaveLength(1);
    const trigger = screen.getByRole('button', { name: /step 3 of 4; 1 earlier stage has steps not checked/ });
    fireEvent.click(trigger);
    const entry = screen.getByRole('button', { name: 'First Call & Payment: Passed — 2 steps not checked' });
    expect(entry).toHaveTextContent('2 steps not checked');
    expect(screen.getByRole('button', { name: 'Intake & JotForm: Passed — all steps checked' })).toHaveTextContent('View');
    fireEvent.click(entry);
    expect(onStepClick).toHaveBeenCalledWith(1);
  });

  it('without counts the header reads exactly as before', () => {
    render(<StageProgress stages={STAGES.map(({ incompleteSteps: _ignored, ...stage }) => stage)} daysWaitingInStage={1} onStepClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Workflow progress: step 3 of 4. Show all stages' })).toBeInTheDocument();
  });
});
