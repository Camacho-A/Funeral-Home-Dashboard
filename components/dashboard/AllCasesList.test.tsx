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

describe('AllCasesList — Case Number moved beneath decedent name (Task #2, 2026-09)', () => {
  it('1/2. renders both the decedent name and the Case Number', () => {
    const { container } = render(<AllCasesList cases={[item]} searchQuery="" />);
    expect(screen.getByText('Robert Ellison')).toBeInTheDocument();
    expect(container.querySelector('[class*="caseNumber"]')?.textContent).toBe('#B2026-001');
  });

  it('3. the Case Number sits immediately beneath the name — a sibling, not nested inside the name element — and follows it in DOM order', () => {
    const { container } = render(<AllCasesList cases={[item]} searchQuery="" />);
    const nameEl = container.querySelector('[class*="name"]')!;
    const caseNumberEl = container.querySelector('[class*="caseNumber"]')!;
    expect(nameEl.textContent).toBe('Robert Ellison'); // no longer contains the case number inline
    expect(nameEl.contains(caseNumberEl)).toBe(false);
    expect(nameEl.compareDocumentPosition(caseNumberEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Immediately beneath — the very next sibling, before the summary line.
    expect(nameEl.nextElementSibling).toBe(caseNumberEl);
  });

  it('5. the Case Number value itself is unchanged', () => {
    const { container } = render(<AllCasesList cases={[item]} searchQuery="" />);
    expect(container.querySelector('[class*="caseNumber"]')?.textContent).toBe('#B2026-001');
  });

  it('6. card navigation is unchanged — still links to the case by internal id', () => {
    render(<AllCasesList cases={[item]} searchQuery="" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/cases/1042');
  });

  it('7. stage/status information remains present alongside the new layout', () => {
    render(<AllCasesList cases={[item]} searchQuery="" />);
    expect(screen.getByText('First Call & Payment')).toBeInTheDocument();
  });

  it('8. no duplicate Case Number is introduced', () => {
    const { container } = render(<AllCasesList cases={[item]} searchQuery="" />);
    expect(container.querySelectorAll('[class*="caseNumber"]')).toHaveLength(1);
  });
});
