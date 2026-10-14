import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { StalledLoading } from './StalledLoading';

/**
 * Stalled-loading recovery (2026-10). Production left staff sitting on
 * "Loading…" indefinitely: the server answered 200, every API answered
 * 200, and the page still never finished rendering. A loading state that
 * never admits defeat is indistinguishable from a broken app.
 */
describe('StalledLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('looks like an ordinary loading state while loading is still reasonable', () => {
    render(<StalledLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });

  it('does not cry wolf over a merely slow page', () => {
    render(<StalledLoading stalledAfterMs={12000} />);
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('admits it is stuck, and offers a way out, once the deadline passes', () => {
    render(<StalledLoading stalledAfterMs={12000} />);
    act(() => {
      vi.advanceTimersByTime(12_001);
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('taking longer than usual');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('reassures that nothing was changed — a stall is not data loss', () => {
    render(<StalledLoading stalledAfterMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('nothing has been changed');
  });

  it('drops its deadline when the real content arrives', () => {
    // The timer must not outlive the fallback, or an unmounted component
    // would try to warn about a page that has long since rendered.
    const { unmount } = render(<StalledLoading stalledAfterMs={1000} />);
    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    }).not.toThrow();
  });
});
