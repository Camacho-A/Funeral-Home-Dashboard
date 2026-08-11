import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FinancialSummaryPanel } from './FinancialSummaryPanel';
import type { DashboardFinancialSection } from '@/services/dashboardService';

const data: DashboardFinancialSection = { grossRevenue: 150000, cashCollected: 100000, accountsReceivableTotal: 50000 };

describe('FinancialSummaryPanel', () => {
  it('formats every figure in dollars', () => {
    render(<FinancialSummaryPanel data={data} />);
    expect(screen.getByText('$1500.00')).toBeInTheDocument();
    expect(screen.getByText('$1000.00')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
  });

  it('links each figure to its own report, never a dead end', () => {
    render(<FinancialSummaryPanel data={data} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/reports/revenue-summary', '/reports/collections-summary', '/reports/outstanding-balance']);
  });
});
