/**
 * Typed references into styles/tokens.css (Frontend Engineering Plan, Phase 1).
 *
 * These are references to the CSS custom properties, not duplicated literal
 * values — styles/tokens.css remains the single source of truth for the
 * actual OKLCH/px values. This module exists so later code (e.g. a future
 * badge-variant mapping consumed by domain/ modules — see
 * docs/adr/ADR-004-domain-layer.md) can refer to a named, typed constant
 * instead of a hand-typed `var(--...)` string.
 */

export const colorTokens = {
  brand: 'var(--color-brand)',
  brandHover: 'var(--color-brand-hover)',
  brandTint: 'var(--color-brand-tint)',
  link: 'var(--color-link)',
  linkHover: 'var(--color-link-hover)',
  dangerBg: 'var(--color-danger-bg)',
  dangerText: 'var(--color-danger-text)',
  dangerBorder: 'var(--color-danger-border)',
  success: 'var(--color-success)',
  successText: 'var(--color-success-text)',
  surfacePage: 'var(--color-surface-page)',
  surfaceCard: 'var(--color-surface-card)',
  surfaceSidebar: 'var(--color-surface-sidebar)',
  surfaceSubtle: 'var(--color-surface-subtle)',
  surfaceMuted: 'var(--color-surface-muted)',
  border: 'var(--color-border)',
  borderSubtle: 'var(--color-border-subtle)',
  scrollbarThumb: 'var(--color-scrollbar-thumb)',
  textPrimary: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-muted)',
  textDisabled: 'var(--color-text-disabled)',
} as const;

export const fontSizeTokens = {
  10: 'var(--font-size-10)',
  10.5: 'var(--font-size-10-5)',
  11: 'var(--font-size-11)',
  11.5: 'var(--font-size-11-5)',
  12: 'var(--font-size-12)',
  12.5: 'var(--font-size-12-5)',
  13: 'var(--font-size-13)',
  13.5: 'var(--font-size-13-5)',
  14: 'var(--font-size-14)',
  15: 'var(--font-size-15)',
  18: 'var(--font-size-18)',
  20: 'var(--font-size-20)',
  26: 'var(--font-size-26)',
  28: 'var(--font-size-28)',
} as const;

export const fontWeightTokens = {
  regular: 'var(--font-weight-regular)',
  medium: 'var(--font-weight-medium)',
  semibold: 'var(--font-weight-semibold)',
  bold: 'var(--font-weight-bold)',
  extrabold: 'var(--font-weight-extrabold)',
} as const;

export const spaceTokens = {
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
  7: 'var(--space-7)',
  8: 'var(--space-8)',
  9: 'var(--space-9)',
  10: 'var(--space-10)',
  11: 'var(--space-11)',
  12: 'var(--space-12)',
  14: 'var(--space-14)',
  16: 'var(--space-16)',
  18: 'var(--space-18)',
  24: 'var(--space-24)',
} as const;

export const radiusTokens = {
  xs: 'var(--radius-xs)',
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
  xl: 'var(--radius-xl)',
  full: 'var(--radius-full)',
} as const;
