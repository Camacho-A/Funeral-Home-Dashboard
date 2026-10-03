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
