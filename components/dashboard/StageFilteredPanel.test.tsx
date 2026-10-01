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
  progressPercent: 50,
};

/** Case list scalability, Phase 3 (2026-09): `stageLabel`/`onBack` are
    gone (the active tab itself now communicates the stage; "back" has no
    meaning once switching stages is just clicking a different tab) —
    replaced by `emptyMessage`/`hasMore`/`isLoadingMore`/`onLoadMore`. */
function renderPanel(overrides: Partial<React.ComponentProps<typeof StageFilteredPanel>> = {}) {
  return render(
    <StageFilteredPanel
      cases={[item]}
      emptyMessage="No cases in this stage."
      selectedCount={0}
      onToggleSelect={vi.fn()}
      onAdvance={vi.fn()}
      hasMore={false}
      isLoadingMore={false}
      onLoadMore={vi.fn()}
      {...overrides}
    />,
  );
}

describe('StageFilteredPanel — decedent avatar (item #7, 2026-09)', () => {
  it("shows the decedent's initials on the row avatar, never \"?\"", () => {
    renderPanel();
    expect(screen.getByText('MR')).toBeInTheDocument();
    expect(screen.queryByText('?')).not.toBeInTheDocument();
  });
});

describe('StageFilteredPanel — Case Number moved beneath decedent name (Task #2, 2026-09)', () => {
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

/**
 * Case list scalability, Phase 3 (2026-09). The "back to all cases" link
 * is gone — tabs replace it.
 */
describe('StageFilteredPanel — no more "back to all cases" (Case list scalability, Phase 3)', () => {
  it('never renders a "back to all cases" control', () => {
    renderPanel();
    expect(screen.queryByText(/back to all cases/i)).not.toBeInTheDocument();
  });

  it('shows the bulk action bar only once at least one case is selected', () => {
    renderPanel({ selectedCount: 0 });
    expect(screen.queryByRole('button', { name: /advance/i })).not.toBeInTheDocument();
  });

  it('shows the bulk action bar once a case is selected', () => {
    renderPanel({ selectedCount: 2 });
    expect(screen.getByRole('button', { name: 'Advance 2 to next stage' })).toBeInTheDocument();
  });
});

describe('StageFilteredPanel — Load More / empty state (Case list scalability, Phase 3)', () => {
  it('shows a Load More button when hasMore is true', () => {
    renderPanel({ hasMore: true });
    expect(screen.getByRole('button', { name: 'Load More' })).toBeInTheDocument();
  });

  it('does not show a Load More button when hasMore is false', () => {
    renderPanel({ hasMore: false });
    expect(screen.queryByRole('button', { name: 'Load More' })).not.toBeInTheDocument();
  });

  it('calls onLoadMore when clicked', () => {
    const onLoadMore = vi.fn();
    renderPanel({ hasMore: true, onLoadMore });
    screen.getByRole('button', { name: 'Load More' }).click();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('renders the caller-provided empty message when there are no cases', () => {
    renderPanel({ cases: [], emptyMessage: 'No cases in this stage.' });
    expect(screen.getByText('No cases in this stage.')).toBeInTheDocument();
  });
});

/**
 * Case list scalability, Phase 3 — progress indicator (2026-09). A
 * stage-filtered list shows the same progress calculation/UI as All
 * Cases (12. "Stage-filtered lists display the same progress
 * calculation") — this list just omits the redundant stage badge since
 * every row here is already known to share one stage.
 */
describe('StageFilteredPanel — case progress indicator (Case list scalability, Phase 3)', () => {
  it('2/3. shows an accessible progress bar with the numeric percentage as real text', () => {
    renderPanel({ cases: [{ ...item, progressPercent: 63 }] });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '63');
    expect(screen.getByText('63% Complete')).toBeInTheDocument();
  });

  it('6. a 0% case displays correctly', () => {
    renderPanel({ cases: [{ ...item, progressPercent: 0 }] });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0% Complete')).toBeInTheDocument();
  });

  it('8. a 100% case displays correctly', () => {
    renderPanel({ cases: [{ ...item, progressPercent: 100 }] });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100% Complete')).toBeInTheDocument();
  });
});
