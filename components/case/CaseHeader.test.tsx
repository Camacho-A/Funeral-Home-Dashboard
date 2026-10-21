import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CaseHeader } from './CaseHeader';

const baseProps = {
  caseNumber: 'B2026-001',
  decedentName: 'Robert Ellison',
  dateOfBirth: '03/14/1951',
  dateOfDeath: '07/09/2026',
  caseDetailStageHeading: 'First Call & Payment',
  stageBadgeVariant: 'neutral' as const,
  daysWaitingInStage: 2,
  slaTargetLabel: '1d',
  isOverdue: false,
};

describe('CaseHeader — Case Number (Phase 16B)', () => {
  it('displays the Case Number prominently near the top, not the internal id', () => {
    render(<CaseHeader {...baseProps} />);
    expect(screen.getByText(/Case #B2026-001/)).toBeInTheDocument();
  });

  it('renders the Case Number as plain text — no input, select, or textarea anywhere it appears', () => {
    const { container } = render(<CaseHeader {...baseProps} />);
    const metaNode = screen.getByText(/Case #B2026-001/);
    expect(['INPUT', 'SELECT', 'TEXTAREA']).not.toContain(metaNode.tagName);
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });
});

describe('CaseHeader — Tag # (Manors launch-prep)', () => {
  it('shows the tag number in the meta line when one is assigned', () => {
    render(<CaseHeader {...baseProps} tagNumber="T-1042" />);
    expect(screen.getByText(/Tag #T-1042/)).toBeInTheDocument();
  });

  it('shows no Tag # segment at all when none is assigned', () => {
    render(<CaseHeader {...baseProps} tagNumber={null} />);
    expect(screen.queryByText(/Tag #/)).not.toBeInTheDocument();
  });
});

describe('CaseHeader — Medical Examiner flag (2026-10)', () => {
  it('flags a Medical Examiner case beside the weight flag', () => {
    // Same kind of fact as "Over 200 lb": a property of the case that
    // changes how staff handle it, and that they should not have to
    // scroll to discover.
    render(<CaseHeader {...baseProps} isMedicalExaminerCase />);
    expect(screen.getByText('Medical Examiner Case')).toBeInTheDocument();
  });

  it('shows nothing on a standard case', () => {
    render(<CaseHeader {...baseProps} isMedicalExaminerCase={false} />);
    expect(screen.queryByText('Medical Examiner Case')).not.toBeInTheDocument();
  });

  it('shows both flags together when both apply', () => {
    render(<CaseHeader {...baseProps} weight="250" weightOver200 isMedicalExaminerCase />);
    expect(screen.getByText('Over 200 lb')).toBeInTheDocument();
    expect(screen.getByText('Medical Examiner Case')).toBeInTheDocument();
  });
});

describe('CaseHeader — Archived badge (2026-10)', () => {
  it('states that an archived case is archived', () => {
    render(<CaseHeader {...baseProps} isArchived />);
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('shows nothing on a live case', () => {
    render(<CaseHeader {...baseProps} isArchived={false} />);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });

  it('keeps the stage heading beside it — the badge adds to the status, it does not replace it', () => {
    render(<CaseHeader {...baseProps} isArchived />);
    expect(screen.getByText('First Call & Payment')).toBeInTheDocument();
  });
});

describe('CaseHeader — SLA tracking (2026-10)', () => {
  const stages = [
    { label: 'First Call', done: true, current: false, viewable: true },
    { label: 'Permit', done: false, current: true, viewable: true },
    { label: 'Pickup', done: false, current: false, viewable: false },
  ];
  const milestone = (overrides: Record<string, unknown>) => ({
    key: 'approval',
    label: 'State approval',
    responsibleParty: 'state',
    advisory: false,
    external: true,
    state: 'active',
    status: 'on_track',
    overdue: false,
    startedAt: null,
    completedAt: null,
    deadline: '2026-10-22',
    businessDaysRemaining: 2,
    delay: null,
    note: null,
    ...overrides,
  });
  const sla = (current: Record<string, unknown> | null, businessDaysInStage: number | null = 0) =>
    ({ enabled: true, milestones: current ? [current] : [], current, businessDaysInStage }) as never;

  it('shows business days in stage and the current SLA, replacing the old stage target', () => {
    render(<CaseHeader {...baseProps} stages={stages} onStepClick={() => {}} sla={sla(milestone({}), 0)} />);
    expect(screen.getByText(/Step 2 of 3/)).toHaveTextContent('Step 2 of 3 · 0 business days in stage');
    expect(screen.getByTestId('current-sla')).toHaveTextContent('Current SLA: State approval · Due in 2 business days');
    expect(screen.getByText('On Track')).toBeInTheDocument();
    expect(screen.getByTestId('current-sla')).toHaveTextContent('State (Vital Statistics)');
    expect(screen.queryByText(/target/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Day 2/)).not.toBeInTheDocument();
  });

  it('an unknown stage-entry time shows no day count rather than "Day 0"', () => {
    render(<CaseHeader {...baseProps} stages={stages} onStepClick={() => {}} sla={sla(milestone({}), null)} />);
    expect(screen.getByText(/Step 2 of 3/).textContent?.trim()).toBe('Step 2 of 3');
  });

  it('a wait on others keeps the overdue fact beside it; a missing start date says so', () => {
    const { unmount } = render(
      <CaseHeader {...baseProps} sla={sla(milestone({ status: 'waiting_on_others', overdue: true, businessDaysRemaining: -2, responsibleParty: 'doctor', label: 'Doctor attestation' }))} />,
    );
    expect(screen.getByText('Waiting on Others')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    unmount();
    render(<CaseHeader {...baseProps} sla={sla(milestone({ state: 'start_date_needed', status: 'start_date_needed', deadline: null, businessDaysRemaining: null }))} />);
    expect(screen.getByText('Start Date Needed')).toBeInTheDocument();
  });

  it('says so when nothing is due, and keeps the old line for organizations without SLA tracking', () => {
    const { unmount } = render(<CaseHeader {...baseProps} sla={sla(null)} />);
    expect(screen.getByText('No SLA due right now')).toBeInTheDocument();
    unmount();
    render(<CaseHeader {...baseProps} />);
    expect(screen.getByText('2d in stage · target 1d')).toBeInTheDocument();
  });
});
