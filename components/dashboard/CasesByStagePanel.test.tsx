import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CasesByStagePanel, type StageBarRow } from './CasesByStagePanel';
import { STAGES } from '@/domain/cases/stages';

const ROWS: StageBarRow[] = STAGES.map((label, i) => ({ label, count: i, pct: (i / 6) * 100 }));

/**
 * Case list scalability, Phase 3 — UX correction (2026-09). Cases by
 * Stage is now a pure navigation hub (every row is a `<Link>` into the
 * dedicated `/cases` route) rather than a local filter — these tests
 * cover that contract directly, replacing the old onSelectStage/
 * `selected`-prop coverage this component used to have.
 */
describe('CasesByStagePanel (Case list scalability, Phase 3 — UX correction)', () => {
  it('renders an "All Cases" link pointing at /cases, with no stage filter', () => {
    render(<CasesByStagePanel allCasesCount={142} rows={ROWS} />);
    const link = screen.getByRole('link', { name: /All Cases/ });
    expect(link).toHaveAttribute('href', '/cases');
    expect(link.textContent).toContain('142');
  });

  it('renders no count suffix on "All Cases" while the count is still loading (null)', () => {
    render(<CasesByStagePanel allCasesCount={null} rows={ROWS} />);
    expect(screen.getByRole('link', { name: 'All Cases' }).textContent).toBe('All Cases');
  });

  it('renders all 7 canonical stages, in order, each linking to /cases?stage=<label>', () => {
    render(<CasesByStagePanel allCasesCount={142} rows={ROWS} />);
    const links = screen.getAllByRole('link').filter((l) => l.getAttribute('href') !== '/cases');
    expect(links).toHaveLength(7);
    links.forEach((link, index) => {
      const url = new URL(link.getAttribute('href')!, 'http://localhost');
      expect(url.pathname).toBe('/cases');
      expect(url.searchParams.get('stage')).toBe(STAGES[index]);
    });
  });

  it("renders each stage's server-provided count", () => {
    render(<CasesByStagePanel allCasesCount={142} rows={ROWS} />);
    expect(screen.getByRole('link', { name: /^Completed/ }).textContent).toContain('6');
  });

  it('renders no count suffix for a stage while counts are still loading (count: null)', () => {
    const loadingRows: StageBarRow[] = [{ label: 'Completed', count: null, pct: 0 }];
    render(<CasesByStagePanel allCasesCount={null} rows={loadingRows} />);
    expect(screen.getByRole('link', { name: 'Completed' }).textContent).toBe('Completed');
  });

  it('never renders a bar fill for a zero-count stage', () => {
    const zeroRows: StageBarRow[] = [{ label: 'Completed', count: 0, pct: 0 }];
    const { container } = render(<CasesByStagePanel allCasesCount={0} rows={zeroRows} />);
    expect(container.querySelector('[style*="width"]')).toBeNull();
  });
});
