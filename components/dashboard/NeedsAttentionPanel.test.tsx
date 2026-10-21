import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NeedsAttentionPanel, type NeedsAttentionCase } from './NeedsAttentionPanel';

const item: NeedsAttentionCase = {
  id: '1042',
  caseNumber: 'B2026-001',
  decedentName: 'Robert Ellison',
  attentionReason: 'Payment overdue',
  daysWaitingInStage: 4,
  slaTargetLabel: '2 days',
};

/**
 * SOLIS true redesign, Phase 1 (2026-10). The row shape changed to match
 * the approved design exactly — case number, then decedent name, then
 * attention reason, no "#" prefix — replacing Task #2's (2026-09)
 * "name, then case number beneath it" layout. This also adds the new
 * zero-state ("All caught up") coverage the component never had before.
 */
describe('NeedsAttentionPanel — row shape (SOLIS true redesign, Phase 1)', () => {
  it('renders the case number, decedent name, and attention reason', () => {
    render(<NeedsAttentionPanel cases={[item]} />);
    expect(screen.getByText('B2026-001')).toBeInTheDocument();
    expect(screen.getByText('Robert Ellison')).toBeInTheDocument();
    expect(screen.getByText('Payment overdue')).toBeInTheDocument();
  });

  it('orders case number before decedent name, per the approved design', () => {
    const { container } = render(<NeedsAttentionPanel cases={[item]} />);
    const caseNumberEl = container.querySelector('[class*="caseNumber"]')!;
    const nameEl = container.querySelector('[class*="name"]')!;
    expect(caseNumberEl.compareDocumentPosition(nameEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('card navigation is unchanged — still links to the case by internal id', () => {
    render(<NeedsAttentionPanel cases={[item]} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/cases/1042');
  });

  it('shows the real case count in the header when there is at least one', () => {
    render(<NeedsAttentionPanel cases={[item]} />);
    expect(screen.getByText('1 cases')).toBeInTheDocument();
  });

  it('no duplicate case number is introduced', () => {
    const { container } = render(<NeedsAttentionPanel cases={[item]} />);
    expect(container.querySelectorAll('[class*="caseNumber"]')).toHaveLength(1);
  });
});

describe('NeedsAttentionPanel — "All caught up" zero-state (SOLIS true redesign, Phase 1)', () => {
  it('shows a compact "All caught up" state when there are no cases, never an empty list/card', () => {
    const { container } = render(<NeedsAttentionPanel cases={[]} />);
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="count"]')).toBeNull();
  });

  it('does not show the zero-state once at least one case needs attention', () => {
    render(<NeedsAttentionPanel cases={[item]} />);
    expect(screen.queryByText('All caught up')).not.toBeInTheDocument();
  });
});

describe('NeedsAttentionPanel — SLA tracking (2026-10)', () => {
  const current = {
    key: 'hard_save',
    label: 'Hard Save',
    responsibleParty: 'staff',
    advisory: false,
    external: false,
    state: 'active',
    status: 'overdue',
    overdue: true,
    startedAt: null,
    completedAt: null,
    deadline: '2026-10-20',
    businessDaysRemaining: -1,
    delay: null,
    note: null,
  };

  it('shows the SLA summary counts when tracking is on, and nothing extra when it is off', () => {
    const { unmount } = render(<NeedsAttentionPanel cases={[]} slaSummary={{ onTrack: 5, dueToday: 1, overdue: 2, waiting: 3 }} />);
    const summary = screen.getByLabelText('SLA summary');
    expect(summary).toHaveTextContent('On track5');
    expect(summary).toHaveTextContent('Due today1');
    expect(summary).toHaveTextContent('Overdue2');
    expect(summary).toHaveTextContent('Waiting on others3');
    unmount();
    const second = render(<NeedsAttentionPanel cases={[]} slaSummary={{ onTrack: 0, dueToday: 0, overdue: 0, waiting: 0, startDateNeeded: 8 }} />);
    expect(screen.getByText(/8 cases need an SLA start date/)).toBeInTheDocument();
    second.unmount();
    render(<NeedsAttentionPanel cases={[]} />);
    expect(screen.queryByLabelText('SLA summary')).not.toBeInTheDocument();
  });

  it('a row shows milestone, deadline, days overdue, who is responsible and the delay', () => {
    const delayed = { ...current, status: 'waiting_on_others', responsibleParty: 'doctor', label: 'Doctor attestation', delay: { reason: 'waiting_on_doctor' } };
    render(
      <NeedsAttentionPanel
        cases={[
          { ...item, sla: { enabled: true, milestones: [], current, businessDaysInStage: 0 } as never },
          { ...item, id: '1043', caseNumber: 'B2026-002', sla: { enabled: true, milestones: [], current: delayed, businessDaysInStage: 0 } as never },
        ]}
      />,
    );
    const rows = screen.getAllByRole('link');
    expect(rows[0]).toHaveTextContent('Hard Save · due Oct 20 · 1 business day overdue · Staff');
    expect(rows[0]).toHaveAttribute('href', '/cases/1042');
    expect(rows[1]).toHaveTextContent('Waiting on Others');
    expect(rows[1]).toHaveTextContent('Overdue');
    expect(rows[1]).toHaveTextContent('Doctor · Waiting on Doctor');
  });
});
