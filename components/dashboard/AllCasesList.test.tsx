import { describe, expect, it, vi } from 'vitest';
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
  progressPercent: 50,
};

/** Case list scalability, Phase 3 (2026-09): `searchQuery` was replaced by
    `emptyMessage`/`hasMore`/`isLoadingMore`/`onLoadMore` — this list no
    longer owns its own full dataset or search string (both now live in
    the paginated hook/page layer). Defaults here match the common
    "nothing special" case so existing tests don't need to restate them. */
function renderList(overrides: Partial<React.ComponentProps<typeof AllCasesList>> = {}) {
  return render(
    <AllCasesList
      cases={[item]}
      emptyMessage="No cases found."
      hasMore={false}
      isLoadingMore={false}
      onLoadMore={vi.fn()}
      {...overrides}
    />,
  );
}

describe('AllCasesList — Case Number displayed in the case list (Phase 16B)', () => {
  it('shows the Case Number alongside the decedent name for every row', () => {
    renderList();
    expect(screen.getByText('#B2026-001')).toBeInTheDocument();
  });

  it('links each row to the case using its internal id, not its Case Number', () => {
    renderList();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/cases/1042');
  });
});

describe('AllCasesList — decedent avatar (item #7, 2026-09)', () => {
  it("4. a named case's row avatar shows the decedent's initials, never \"?\"", () => {
    renderList();
    expect(screen.getByText('RE')).toBeInTheDocument();
    expect(screen.queryByText('?')).not.toBeInTheDocument();
  });
});

describe('AllCasesList — Case Number moved beneath decedent name (Task #2, 2026-09)', () => {
  it('1/2. renders both the decedent name and the Case Number', () => {
    const { container } = renderList();
    expect(screen.getByText('Robert Ellison')).toBeInTheDocument();
    expect(container.querySelector('[class*="caseNumber"]')?.textContent).toBe('#B2026-001');
  });

  it('3. the Case Number sits immediately beneath the name — a sibling, not nested inside the name element — and follows it in DOM order', () => {
    const { container } = renderList();
    const nameEl = container.querySelector('[class*="name"]')!;
    const caseNumberEl = container.querySelector('[class*="caseNumber"]')!;
    expect(nameEl.textContent).toBe('Robert Ellison'); // no longer contains the case number inline
    expect(nameEl.contains(caseNumberEl)).toBe(false);
    expect(nameEl.compareDocumentPosition(caseNumberEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Immediately beneath — the very next sibling, before the summary line.
    expect(nameEl.nextElementSibling).toBe(caseNumberEl);
  });

  it('5. the Case Number value itself is unchanged', () => {
    const { container } = renderList();
    expect(container.querySelector('[class*="caseNumber"]')?.textContent).toBe('#B2026-001');
  });

  it('6. card navigation is unchanged — still links to the case by internal id', () => {
    renderList();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/cases/1042');
  });

  it('7. stage/status information remains present alongside the new layout', () => {
    renderList();
    expect(screen.getByText('First Call & Payment')).toBeInTheDocument();
  });

  it('8. no duplicate Case Number is introduced', () => {
    const { container } = renderList();
    expect(container.querySelectorAll('[class*="caseNumber"]')).toHaveLength(1);
  });
});

/**
 * Case list scalability, Phase 3 (2026-09). Load More / empty state.
 */
describe('AllCasesList — Load More (Case list scalability, Phase 3)', () => {
  it('shows a Load More button when hasMore is true', () => {
    renderList({ hasMore: true });
    expect(screen.getByRole('button', { name: 'Load More' })).toBeInTheDocument();
  });

  it('does not show a Load More button when hasMore is false', () => {
    renderList({ hasMore: false });
    expect(screen.queryByRole('button', { name: 'Load More' })).not.toBeInTheDocument();
  });

  it('calls onLoadMore when the button is clicked', () => {
    const onLoadMore = vi.fn();
    renderList({ hasMore: true, onLoadMore });
    screen.getByRole('button', { name: 'Load More' }).click();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows a loading label and disables the button while isLoadingMore is true', () => {
    renderList({ hasMore: true, isLoadingMore: true });
    const button = screen.getByRole('button', { name: 'Loading…' });
    expect(button).toBeDisabled();
  });

  it('renders the caller-provided empty message when there are no cases', () => {
    renderList({ cases: [], emptyMessage: 'No cases found.' });
    expect(screen.getByText('No cases found.')).toBeInTheDocument();
  });

  it('does not render an empty message when cases are present', () => {
    renderList({ emptyMessage: 'No cases found.' });
    expect(screen.queryByText('No cases found.')).not.toBeInTheDocument();
  });
});

/**
 * Case list scalability, Phase 3 — progress indicator (2026-09). The row
 * still shows its canonical current stage (via the existing Badge,
 * covered above) — these prove the progress bar is a complementary
 * addition, never a replacement for it.
 */
describe('AllCasesList — case progress indicator (Case list scalability, Phase 3)', () => {
  it('1. still shows the current stage', () => {
    renderList();
    expect(screen.getByText('First Call & Payment')).toBeInTheDocument();
  });

  it('2/3. shows an accessible progress bar with the numeric percentage as real text', () => {
    renderList({ cases: [{ ...item, progressPercent: 63 }] });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '63');
    expect(screen.getByText('63% Complete')).toBeInTheDocument();
  });

  it('6. a 0% case displays correctly', () => {
    renderList({ cases: [{ ...item, progressPercent: 0 }] });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0% Complete')).toBeInTheDocument();
  });

  it('8. a 100% case displays correctly', () => {
    renderList({ cases: [{ ...item, progressPercent: 100 }] });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100% Complete')).toBeInTheDocument();
  });

  it('never shows decimal precision — always a whole-number percentage', () => {
    renderList({ cases: [{ ...item, progressPercent: 76.9230769 }] });
    expect(screen.getByText('77% Complete')).toBeInTheDocument();
  });
});

describe('AllCasesList — case status label (2026-10)', () => {
  /** The class the status line carries, as the component resolves it. */
  function summaryClassFor(text: string) {
    return screen.getByText(text).className;
  }

  it('renders the status line directly under the case number and keeps the row clickable', () => {
    renderList({ cases: [{ ...item, rowSummaryText: 'Completed', rowSummaryVariant: 'success' }] });

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/cases/1042');
    // Case number, then status, in that order inside the same row.
    const rowText = link.textContent ?? '';
    expect(rowText.indexOf('#B2026-001')).toBeLessThan(rowText.indexOf('Completed'));
  });

  it('styles an incomplete case neutrally', () => {
    renderList({ cases: [{ ...item, rowSummaryText: 'Review case', rowSummaryVariant: 'neutral' }] });
    expect(summaryClassFor('Review case')).toMatch(/summaryNeutral/);
    expect(summaryClassFor('Review case')).not.toMatch(/summaryComplete|summaryArchived/);
  });

  it('styles a completed case with the success colour', () => {
    renderList({ cases: [{ ...item, rowSummaryText: 'Completed', rowSummaryVariant: 'success' }] });
    expect(summaryClassFor('Completed')).toMatch(/summaryComplete/);
  });

  it('styles an archived case with the muted archived colour', () => {
    renderList({ cases: [{ ...item, rowSummaryText: 'Archived', rowSummaryVariant: 'archived' }] });
    expect(summaryClassFor('Archived')).toMatch(/summaryArchived/);
  });

  it('still styles a stalled case as a blocker', () => {
    renderList({ cases: [{ ...item, rowSummaryText: 'Waiting on ME release', rowSummaryVariant: 'danger' }] });
    expect(summaryClassFor('Waiting on ME release')).toMatch(/summaryDanger/);
  });

  it('renders every status through the one .summary element, so mobile and desktop cannot diverge', () => {
    // The mobile rules in AllCasesList.module.css only change `.summary`'s
    // wrapping; the state class (and therefore the colour) is the same
    // element at every width. One row, one element, one class.
    for (const [text, variant] of [
      ['Review case', 'neutral'],
      ['Completed', 'success'],
      ['Archived', 'archived'],
    ] as const) {
      const { unmount } = renderList({ cases: [{ ...item, rowSummaryText: text, rowSummaryVariant: variant }] });
      expect(summaryClassFor(text)).toMatch(/\bsummary\b|summary_/);
      unmount();
    }
  });
});
