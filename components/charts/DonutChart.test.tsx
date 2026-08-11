import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DonutChart } from './DonutChart';

describe('DonutChart', () => {
  const slices = [
    { label: 'Complete', value: 3, variant: 'success' as const },
    { label: 'In progress', value: 1, variant: 'brand' as const },
  ];

  it('renders one SVG circle per slice plus the track circle, aria-hidden (decorative)', () => {
    const { container } = render(<DonutChart slices={slices} title="VA Case Status" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('circle')).toHaveLength(3); // track + 2 slices
  });

  it('renders an accessible table with each slice\'s value and computed share', () => {
    render(<DonutChart slices={slices} title="VA Case Status" />);
    expect(screen.getByRole('table', { name: 'VA Case Status' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Complete' })).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders a visible legend with the same labels', () => {
    render(<DonutChart slices={slices} title="VA Case Status" />);
    expect(screen.getAllByText('Complete').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
  });
});
