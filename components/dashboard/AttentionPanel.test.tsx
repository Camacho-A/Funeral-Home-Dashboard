import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttentionPanel } from './AttentionPanel';
import type { DashboardAttentionSection } from '@/services/dashboardService';

describe('AttentionPanel', () => {
  it('renders all four rows with their values', () => {
    const data: DashboardAttentionSection = { overdueCases: 2, overdueTasks: 0, outstandingSignatures: 1, failedPayments: 0 };
    render(<AttentionPanel data={data} />);
    expect(screen.getByText('Overdue cases')).toBeInTheDocument();
    expect(screen.getByText('Overdue tasks')).toBeInTheDocument();
    expect(screen.getByText('Outstanding signatures')).toBeInTheDocument();
    expect(screen.getByText('Failed payments')).toBeInTheDocument();
  });

  it('links every row to a report, never a dead end', () => {
    const data: DashboardAttentionSection = { overdueCases: 0, overdueTasks: 0, outstandingSignatures: 0, failedPayments: 0 };
    render(<AttentionPanel data={data} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(links.every((l) => l.getAttribute('href')?.startsWith('/reports/'))).toBe(true);
  });

  it('gives a nonzero value the alert styling', () => {
    const data: DashboardAttentionSection = { overdueCases: 3, overdueTasks: 0, outstandingSignatures: 0, failedPayments: 0 };
    render(<AttentionPanel data={data} />);
    const overdueCasesValue = screen.getByText('3');
    expect(overdueCasesValue.className).toMatch(/valueAlert/);
    const overdueTasksValue = screen.getByText('Overdue tasks').closest('a')?.querySelector('span:last-child');
    expect(overdueTasksValue?.className).not.toMatch(/valueAlert/);
  });
});
