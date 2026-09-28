import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageFilteredPanel, type StageFilteredCase } from './StageFilteredPanel';

const item: StageFilteredCase = {
  id: '1042',
  caseNumber: 'B2026-001',
  decedentName: 'Maria Rodriguez',
  decedentInitials: 'MR',
  rowSummaryText: 'Awaiting doctor signature',
  rowSummaryVariant: 'neutral',
  isStalled: false,
  selected: false,
};

/**
 * Item #7 (2026-09, decedent avatar fix). This component previously had no
 * dedicated test file — added here since its row avatar is one of the two
 * directly-affected decedent-avatar surfaces.
 */
describe('StageFilteredPanel — decedent avatar (item #7, 2026-09)', () => {
  it("shows the decedent's initials on the row avatar, never \"?\"", () => {
    render(
      <StageFilteredPanel
        stageLabel="First Call & Payment"
        cases={[item]}
        selectedCount={0}
        onToggleSelect={vi.fn()}
        onAdvance={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText('MR')).toBeInTheDocument();
    expect(screen.queryByText('?')).not.toBeInTheDocument();
  });
});

describe('StageFilteredPanel — Case Number moved beneath decedent name (Task #2, 2026-09)', () => {
  function renderPanel() {
    return render(
      <StageFilteredPanel
        stageLabel="First Call & Payment"
        cases={[item]}
        selectedCount={0}
        onToggleSelect={vi.fn()}
        onAdvance={vi.fn()}
        onBack={vi.fn()}
      />,
    );
  }

  it('1/2. renders both the decedent name and the Case Number', () => {
    const { container } = renderPanel();
    expect(screen.getByText('Maria Rodriguez')).toBeInTheDocument();
    expect(container.querySelector('[class*="caseNumber"]')?.textContent).toBe('#B2026-001');
  });

  it('3. the Case Number sits immediately beneath the name — a sibling, not nested inside the name element — and follows it in DOM order', () => {
    const { container } = renderPanel();
    const nameEl = container.querySelector('[class*="name"]')!;
    const caseNumberEl = container.querySelector('[class*="caseNumber"]')!;
    expect(nameEl.textContent).toBe('Maria Rodriguez');
    expect(nameEl.contains(caseNumberEl)).toBe(false);
    expect(nameEl.compareDocumentPosition(caseNumberEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nameEl.nextElementSibling).toBe(caseNumberEl);
  });

  it('5. the Case Number value itself is unchanged', () => {
    const { container } = renderPanel();
    expect(container.querySelector('[class*="caseNumber"]')?.textContent).toBe('#B2026-001');
  });

  it('6. card navigation is unchanged — still links to the case by internal id', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: /Maria Rodriguez/ })).toHaveAttribute('href', '/cases/1042');
  });

  it('7. remaining case-card information (row summary) stays present', () => {
    renderPanel();
    expect(screen.getByText('Awaiting doctor signature')).toBeInTheDocument();
  });

  it('8. no duplicate Case Number is introduced', () => {
    const { container } = renderPanel();
    expect(container.querySelectorAll('[class*="caseNumber"]')).toHaveLength(1);
  });
});
