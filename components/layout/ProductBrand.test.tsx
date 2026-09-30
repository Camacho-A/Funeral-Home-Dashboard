import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
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
    render(<ProductBrand variant="vertical" markSize={72} />);
    const mark = screen.getByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('width', '72');
    expect(mark).toHaveAttribute('height', '72');
  });

  it('keeps the mark decorative in both variants', () => {
    render(<ProductBrand variant="vertical" />);
    const mark = screen.getByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('alt', '');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  /**
   * Task #19 (2026-09, Login logo fix). The rendered <img src> is only
   * ever a string — it proves nothing about whether public/brand/
   * soliscode-mark.png actually exists on disk with that *exact*
   * capitalization. A case-sensitive production filesystem (Vercel's
   * Linux, unlike a developer's typically case-insensitive macOS/Windows
   * checkout) would 404 a mismatched-case reference even though the
   * asset "exists" locally — a real, recurring class of "works on my
   * machine, broken in Production" bug this task's audit specifically
   * asked to rule out. This test reads the actual public/brand directory
   * and asserts the on-disk filename is byte-for-byte identical to what
   * ProductBrand references, not just case-insensitively present.
   */
  it('references an asset that exists on disk with the exact same capitalization (guards the case-sensitivity class of "works locally, broken in Production" bug)', () => {
    const referencedPath = '/brand/soliscode-mark.png';
    const relativeAssetPath = referencedPath.replace(/^\//, '');
    const absoluteAssetPath = path.join(process.cwd(), 'public', relativeAssetPath);

    expect(existsSync(absoluteAssetPath)).toBe(true);

    const dir = path.dirname(absoluteAssetPath);
    const expectedFilename = path.basename(absoluteAssetPath);
    const actualFilenames = readdirSync(dir);
    expect(actualFilenames).toContain(expectedFilename);
  });
});
