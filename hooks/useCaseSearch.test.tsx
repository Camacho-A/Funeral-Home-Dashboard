import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { CaseSearchProvider, useCaseSearch } from './useCaseSearch';

/**
 * Shared case-search state. useCaseSearch.tsx's own comment has long
 * claimed "the debounce mechanism itself has its own dedicated test
 * (useCaseSearch.test.tsx)" — it did not exist until this file, so the
 * debounce was in fact untested. Covered here along with `submitQuery`,
 * added (2026-10) so the Return key applies a search immediately instead
 * of leaving the viewer waiting out the debounce.
 */

const DEBOUNCE_MS = 300;

function Probe() {
  const { query, setQuery, debouncedQuery, submitQuery } = useCaseSearch();
  return (
    <div>
      <input aria-label="query" value={query} onChange={(e) => setQuery(e.target.value)} />
      <button type="button" onClick={submitQuery}>
        submit
      </button>
      <span data-testid="query">{query}</span>
      <span data-testid="debounced">{debouncedQuery}</span>
    </div>
  );
}

function renderProbe() {
  render(
    <CaseSearchProvider>
      <Probe />
    </CaseSearchProvider>,
  );
  return {
    type: (value: string) => fireEvent.change(screen.getByLabelText('query'), { target: { value } }),
    submit: () => fireEvent.click(screen.getByRole('button', { name: 'submit' })),
    query: () => screen.getByTestId('query').textContent,
    debounced: () => screen.getByTestId('debounced').textContent,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CaseSearchProvider — debounce', () => {
  it('updates query immediately so typing never feels delayed', () => {
    const probe = renderProbe();
    probe.type('morales');
    expect(probe.query()).toBe('morales');
  });

  it('holds debouncedQuery back until typing pauses', () => {
    const probe = renderProbe();
    probe.type('morales');
    expect(probe.debounced()).toBe('');

    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS - 1));
    expect(probe.debounced()).toBe('');

    act(() => void vi.advanceTimersByTime(1));
    expect(probe.debounced()).toBe('morales');
  });

  it('restarts the wait on each keystroke, so mid-word values never reach debouncedQuery', () => {
    const probe = renderProbe();
    probe.type('mor');
    act(() => void vi.advanceTimersByTime(200));
    probe.type('morales');
    act(() => void vi.advanceTimersByTime(200));

    expect(probe.debounced()).toBe('');
    act(() => void vi.advanceTimersByTime(100));
    expect(probe.debounced()).toBe('morales');
  });
});

describe('CaseSearchProvider — submitQuery (the Return key)', () => {
  it('applies the current query immediately, without waiting out the debounce', () => {
    const probe = renderProbe();
    probe.type('morales');
    expect(probe.debounced()).toBe('');

    probe.submit();
    expect(probe.debounced()).toBe('morales');
  });

  it('cancels the pending debounce, so no second redundant update lands afterwards', () => {
    const probe = renderProbe();
    probe.type('morales');
    probe.submit();
    expect(probe.debounced()).toBe('morales');

    // Running the clock past the original timeout must not change anything.
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS * 2));
    expect(probe.debounced()).toBe('morales');
    expect(probe.query()).toBe('morales');
  });

  it('is safe to press with nothing typed', () => {
    const probe = renderProbe();
    probe.submit();
    expect(probe.debounced()).toBe('');
  });

  it('applies a cleared query immediately too, so Return on an emptied box resets the list', () => {
    const probe = renderProbe();
    probe.type('morales');
    probe.submit();
    expect(probe.debounced()).toBe('morales');

    probe.type('');
    probe.submit();
    expect(probe.debounced()).toBe('');
  });
});
