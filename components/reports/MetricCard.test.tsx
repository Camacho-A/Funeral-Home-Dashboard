import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetricCard } from './MetricCard';

describe('MetricCard', () => {
  it('renders a plain count value', () => {
    render(<MetricCard displayName="Active Cases" value={8} dataType="count" unit="cases" />);
    expect(screen.getByText('Active Cases')).toBeInTheDocument();
    expect(screen.getByText('8 cases')).toBeInTheDocument();
  });

  it('formats a currency value in dollars', () => {
    render(<MetricCard displayName="Gross Revenue" value={12345} dataType="currency" unit="cents" />);
    expect(screen.getByText('$123.45')).toBeInTheDocument();
  });

  it('formats a days value with correct pluralization', () => {
    render(<MetricCard displayName="Avg. Cycle Time" value={1} dataType="days" unit="days" />);
    expect(screen.getByText('1 day')).toBeInTheDocument();
  });

  it('renders as a plain div (not a button) when no onDrillDown is given', () => {
    render(<MetricCard displayName="Active Cases" value={8} dataType="count" unit="cases" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders as a clickable button and fires onDrillDown when given', () => {
    const onDrillDown = vi.fn();
    render(<MetricCard displayName="Active Cases" value={8} dataType="count" unit="cases" onDrillDown={onDrillDown} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onDrillDown).toHaveBeenCalledTimes(1);
  });

  it('shows the row count for an array value rather than the raw array', () => {
    render(<MetricCard displayName="Cases by Stage" value={[{ a: 1 }, { a: 2 }]} dataType="count" unit="" />);
    expect(screen.getByText('2 rows')).toBeInTheDocument();
  });
});
