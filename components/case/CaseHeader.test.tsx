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
