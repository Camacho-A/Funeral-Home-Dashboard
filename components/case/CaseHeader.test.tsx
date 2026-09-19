import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CaseHeader } from './CaseHeader';

const baseProps = {
  caseNumber: 'B2026-001',
  decedentName: 'Robert Ellison',
  dateOfBirth: '03/14/1951',
  dateOfDeath: '07/09/2026',
  stageLabel: 'First Call & Payment',
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
