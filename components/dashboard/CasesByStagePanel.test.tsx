import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CasesByStagePanel, type StageBarRow, type StagePreviewCase } from './CasesByStagePanel';
import { STAGES } from '@/domain/cases/stages';

const ROWS: StageBarRow[] = STAGES.map((label, i) => ({ label, count: i, pct: (i / 6) * 100, displayStage: i }));

const CASES_BY_STAGE: Record<string, StagePreviewCase[]> = {
  Completed: [
    { id: 'case-1', caseNumber: 'B2026-001', decedentName: 'Robert Ellison', daysWaitingInStage: 0 },
    { id: 'case-2', caseNumber: 'B2026-002', decedentName: 'Maria Gomez', daysWaitingInStage: 3 },
  ],
};

/**
 * SOLIS true redesign, Phase 1 (2026-10). Cases by Stage remains a pure
 * navigation hub ("All cases" and "Open full stage list →" are real
 * links into the existing `/cases` route, unchanged) but each stage row
 * is now an accordion toggle — replacing the old Case list scalability,
 * Phase 3 contract where every row was itself a `<Link>`. These tests
 * replace that file's coverage with the new accordion contract: this is
 * the one explicitly approved Dashboard interaction change in this
 * phase.
 */
describe('CasesByStagePanel — Stage Preview accordion (SOLIS true redesign, Phase 1)', () => {
  it('renders an "All cases" link pointing at /cases, with the server-provided count', () => {
    render(<CasesByStagePanel allCasesCount={142} rows={ROWS} casesByStage={{}} />);
    const link = screen.getByRole('link', { name: /All cases/ });
    expect(link).toHaveAttribute('href', '/cases');
    expect(link.textContent).toContain('142');
  });

  it('renders no count suffix on "All cases" while the count is still loading (null)', () => {
    render(<CasesByStagePanel allCasesCount={null} rows={ROWS} casesByStage={{}} />);
    expect(screen.getByRole('link', { name: 'All cases' }).textContent).toBe('All cases');
  });

  it('renders all 7 canonical stages, in order, as collapsed toggle buttons', () => {
    render(<CasesByStagePanel allCasesCount={142} rows={ROWS} casesByStage={{}} />);
    STAGES.forEach((label, index) => {
      const button = screen.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button.textContent).toContain(String(index));
    });
  });

  it('clicking a closed stage expands it, showing its real cases and "Open full stage list →"', () => {
    render(<CasesByStagePanel allCasesCount={2} rows={ROWS} casesByStage={CASES_BY_STAGE} />);
    const toggle = screen.getByRole('button', { name: /^Completed/ });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Robert Ellison')).toBeInTheDocument();
    expect(screen.getByText('Maria Gomez')).toBeInTheDocument();
    const openFull = screen.getByRole('link', { name: 'Open full stage list →' });
    const url = new URL(openFull.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/cases');
    expect(url.searchParams.get('stage')).toBe('Completed');
  });

  it('each preview case row links to its own existing Case Detail route', () => {
    render(<CasesByStagePanel allCasesCount={2} rows={ROWS} casesByStage={CASES_BY_STAGE} />);
    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
    expect(screen.getByRole('link', { name: /Robert Ellison/ })).toHaveAttribute('href', '/cases/case-1');
    expect(screen.getByRole('link', { name: /Maria Gomez/ })).toHaveAttribute('href', '/cases/case-2');
  });

  it('clicking a different stage closes the previously open one — only one stage open at a time', () => {
    render(<CasesByStagePanel allCasesCount={2} rows={ROWS} casesByStage={CASES_BY_STAGE} />);
    const completed = screen.getByRole('button', { name: /^Completed/ });
    const firstCall = screen.getByRole('button', { name: /^First Call & Payment/ });

    fireEvent.click(completed);
    expect(completed).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(firstCall);
    expect(firstCall).toHaveAttribute('aria-expanded', 'true');
    expect(completed).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Robert Ellison')).not.toBeInTheDocument();
  });

  it('clicking the open stage again collapses it', () => {
    render(<CasesByStagePanel allCasesCount={2} rows={ROWS} casesByStage={CASES_BY_STAGE} />);
    const toggle = screen.getByRole('button', { name: /^Completed/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Robert Ellison')).not.toBeInTheDocument();
  });

  it('opening a stage with no cases shows the compact empty state, never a case list or large empty card', () => {
    render(<CasesByStagePanel allCasesCount={0} rows={ROWS} casesByStage={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
    expect(screen.getByText('No cases in this stage')).toBeInTheDocument();
  });

  it('renders no count for a stage while counts are still loading (count: null)', () => {
    const loadingRows: StageBarRow[] = [{ label: 'Completed', count: null, pct: 0, displayStage: 6 }];
    render(<CasesByStagePanel allCasesCount={null} rows={loadingRows} casesByStage={{}} />);
    const button = screen.getByRole('button', { name: /^Completed/ });
    expect(within(button).getByText('—')).toBeInTheDocument();
  });
});
