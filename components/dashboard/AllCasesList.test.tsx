import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AllCasesList, type AllCasesListItem } from './AllCasesList';

const item: AllCasesListItem = {
  id: '1042',
  caseNumber: 'B2026-001',
  decedentName: 'Robert Ellison',
  decedentInitials: 'RE',
  rowSummaryText: 'Awaiting doctor signature',
  rowSummaryVariant: 'neutral',
  isOverdue: false,
  stageLabel: 'First Call & Payment',
  stageBadgeVariant: 'neutral',
};

describe('AllCasesList — Case Number displayed in the case list (Phase 16B)', () => {
  it('shows the Case Number alongside the decedent name for every row', () => {
    render(<AllCasesList cases={[item]} searchQuery="" />);
    expect(screen.getByText('#B2026-001')).toBeInTheDocument();
  });

  it('links each row to the case using its internal id, not its Case Number', () => {
    render(<AllCasesList cases={[item]} searchQuery="" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/cases/1042');
  });
});

describe('AllCasesList — decedent avatar (item #7, 2026-09)', () => {
  it("4. a named case's row avatar shows the decedent's initials, never \"?\"", () => {
    render(<AllCasesList cases={[item]} searchQuery="" />);
    expect(screen.getByText('RE')).toBeInTheDocument();
    expect(screen.queryByText('?')).not.toBeInTheDocument();
  });
});
