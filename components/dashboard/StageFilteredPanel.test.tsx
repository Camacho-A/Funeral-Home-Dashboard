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
