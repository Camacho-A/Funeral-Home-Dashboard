import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarChart } from './BarChart';

describe('BarChart', () => {
  const rows = [
    { label: 'First Call & Payment', value: 2 },
    { label: 'Completed', value: 5 },
  ];

  it('renders one SVG rect per row, aria-hidden (decorative)', () => {
    const { container } = render(<BarChart rows={rows} title="Cases by Stage" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('rect')).toHaveLength(2);
  });

  it('renders an accessible table with the same data as the visual chart', () => {
    render(<BarChart rows={rows} unit="cases" title="Cases by Stage" />);
    const table = screen.getByRole('table', { name: 'Cases by Stage' });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'First Call & Payment' })).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders visible (non-table) labels too', () => {
    render(<BarChart rows={rows} unit="cases" title="Cases by Stage" />);
    expect(screen.getByText('2 cases')).toBeInTheDocument();
  });
});
