import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar (Case list scalability, Phase 3 — progress indicator, 2026-09)', () => {
  it('exposes the value accessibly via role="progressbar" and aria-valuenow/min/max', () => {
    render(<ProgressBar percent={63} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '63');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders the numeric percentage as real text, not only via color/width', () => {
    render(<ProgressBar percent={63} />);
    expect(screen.getByText('63% Complete')).toBeInTheDocument();
  });

  it('clamps a negative percentage to 0', () => {
    render(<ProgressBar percent={-10} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0% Complete')).toBeInTheDocument();
  });

  it('clamps a percentage above 100 to 100', () => {
    render(<ProgressBar percent={140} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100% Complete')).toBeInTheDocument();
  });

  it('rounds to a whole number — never excessive decimal precision', () => {
    render(<ProgressBar percent={76.9230769} />);
    expect(screen.getByText('77% Complete')).toBeInTheDocument();
  });
});
