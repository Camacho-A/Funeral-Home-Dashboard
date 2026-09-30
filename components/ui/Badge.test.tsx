import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

/**
 * Task #14 Phase C (2026-09, SOLIS shared-component unification). No test
 * file existed for Badge before this phase. Covers: text content is
 * preserved regardless of variant (12: "Badge text/status meanings remain
 * unchanged" — Badge never decides what a status means, only renders
 * whatever variant it's told), and that the new `neutral` fix and new
 * `warning` variant render distinctly from `brand`.
 */
describe('Badge', () => {
  it('renders its children as visible text regardless of variant', () => {
    render(<Badge variant="danger">Overdue</Badge>);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('defaults to the neutral variant', () => {
    const { container } = render(<Badge>Draft</Badge>);
    expect(container.querySelector('[class*="neutral"]')).not.toBeNull();
  });

  it('Task #14 Phase C: neutral no longer shares a class with brand — they are visually distinct variants', () => {
    const neutral = render(<Badge variant="neutral">Draft</Badge>);
    const neutralEl = neutral.container.firstElementChild!;
    neutral.unmount();
    const brand = render(<Badge variant="brand">Active</Badge>);
    const brandEl = brand.container.firstElementChild!;
    expect(neutralEl.className).not.toBe(brandEl.className);
  });

  it('Task #14 Phase C: the new warning variant renders with its own distinct class', () => {
    const { container } = render(<Badge variant="warning">Attention</Badge>);
    expect(container.querySelector('[class*="warning"]')).not.toBeNull();
    expect(screen.getByText('Attention')).toBeInTheDocument();
  });

  it('all five variants render without throwing', () => {
    const variants = ['neutral', 'brand', 'danger', 'success', 'warning'] as const;
    for (const variant of variants) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant)).toBeInTheDocument();
      unmount();
    }
  });
});
