import { describe, expect, it, vi } from 'vitest';

// next/font/google requires the Next.js SWC build-time transform, which
// plain Vitest has no equivalent for — mocked here purely so importing
// app/layout.tsx (to read its exported `metadata`) doesn't throw outside
// a real Next.js build. Mirrors this codebase's existing "mock only the
// framework API a plain Vitest test has no context for" convention.
vi.mock('next/font/google', () => ({
  Work_Sans: () => ({ variable: '--font-work-sans' }),
}));

const { metadata } = await import('./layout');

describe('root layout metadata', () => {
  /** Solis rename (2026-09): the browser-tab title is the single point of
      control for the entire app's page title (staff and Family Portal
      alike — the Family Portal layout carries no override). Must read
      "Solis", never the retired "Beacon" branding. */
  it('title is Solis', () => {
    expect(metadata.title).toBe('Solis');
  });
});
