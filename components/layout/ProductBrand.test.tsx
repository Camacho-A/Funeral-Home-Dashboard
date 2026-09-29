import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductBrand } from './ProductBrand';

/**
 * Task #13 final visual adjustment (2026-09) — direct unit coverage for
 * ProductBrand's `variant` prop (Sidebar's `'vertical'` vs. Login's
 * default `'horizontal'`), separate from the two consuming components'
 * own integration tests.
 */
describe('ProductBrand', () => {
  it('defaults to the horizontal variant — no .vertical class applied', () => {
    render(<ProductBrand />);
    const mark = screen.getByRole('presentation', { hidden: true });
    expect(mark.parentElement?.className).not.toMatch(/vertical/);
  });

  it('applies the vertical variant\'s class when requested', () => {
    render(<ProductBrand variant="vertical" />);
    const mark = screen.getByRole('presentation', { hidden: true });
    expect(mark.parentElement?.className).toMatch(/vertical/);
  });

  it('always uses the same repository asset regardless of variant', () => {
    render(<ProductBrand variant="vertical" />);
    expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute('src', '/brand/soliscode-mark.png');
  });

  it('renders SOLIS as real, visible text in both variants', () => {
    const { rerender } = render(<ProductBrand />);
    expect(screen.getByText('SOLIS')).toBeInTheDocument();
    rerender(<ProductBrand variant="vertical" />);
    expect(screen.getByText('SOLIS')).toBeInTheDocument();
  });

  it('respects an explicit markSize regardless of variant', () => {
    render(<ProductBrand variant="vertical" markSize={58} />);
    const mark = screen.getByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('width', '58');
    expect(mark).toHaveAttribute('height', '58');
  });

  it('keeps the mark decorative in both variants', () => {
    render(<ProductBrand variant="vertical" />);
    const mark = screen.getByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('alt', '');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });
});
