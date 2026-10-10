import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

/**
 * Case Info tab (2026-10). This hook already shipped (the Calendar page's
 * narrow-viewport fallback) but had no tests. It now also decides whether
 * Case Detail shows Case Information as a mobile tab or in the desktop
 * rail, so the two behaviours that decision depends on — the SSR-safe
 * initial `false`, and reacting to a viewport change — are pinned here.
 */

type Listener = (event: MediaQueryListEvent) => void;

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initial,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return {
    /** Simulates the viewport crossing the breakpoint. */
    change(matches: boolean) {
      mql.matches = matches;
      act(() => {
        for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
      });
    },
    listenerCount: () => listeners.size,
  };
}

function Probe({ query }: { query: string }) {
  const matches = useMediaQuery(query);
  return <span data-testid="result">{String(matches)}</span>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('reports the query result once mounted', () => {
    stubMatchMedia(true);
    render(<Probe query="(max-width: 560px)" />);
    expect(screen.getByTestId('result')).toHaveTextContent('true');
  });

  it('reports false for a non-matching query', () => {
    stubMatchMedia(false);
    render(<Probe query="(max-width: 560px)" />);
    expect(screen.getByTestId('result')).toHaveTextContent('false');
  });

  it('updates when the viewport crosses the breakpoint, in both directions', () => {
    // This is what moves Case Information between the mobile tab and the
    // desktop rail without a reload.
    const media = stubMatchMedia(false);
    render(<Probe query="(max-width: 560px)" />);
    expect(screen.getByTestId('result')).toHaveTextContent('false');

    media.change(true);
    expect(screen.getByTestId('result')).toHaveTextContent('true');

    media.change(false);
    expect(screen.getByTestId('result')).toHaveTextContent('false');
  });

  it('unsubscribes on unmount, so a removed page never keeps reacting to resizes', () => {
    const media = stubMatchMedia(true);
    const { unmount } = render(<Probe query="(max-width: 560px)" />);
    expect(media.listenerCount()).toBe(1);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
