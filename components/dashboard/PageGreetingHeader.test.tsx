import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageGreetingHeader } from './PageGreetingHeader';
import { SessionProvider } from '@/hooks/useSession';

/**
 * Manors cleanup phase (Task #6, personalized dashboard greeting). Before
 * this fix, the greeting was a hardcoded "Good afternoon" literal with no
 * time-of-day logic at all and no name — these tests cover both the
 * newly-added time-of-day computation and the name personalization,
 * sourced from `SessionProvider` (never a hardcoded name, never an
 * email/id).
 */
function renderGreeting(displayName: string, hour: number) {
  vi.setSystemTime(new Date(2026, 0, 1, hour, 0, 0));
  return render(
    <SessionProvider value={{ staffId: 'staff-test', displayName }}>
      <PageGreetingHeader todayLabel="Thursday, January 1" activeCount={5} />
    </SessionProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PageGreetingHeader', () => {
  it('shows "Good morning" before noon', () => {
    renderGreeting('Jordan Rivera', 9);
    expect(screen.getByText('Good morning, Jordan')).toBeInTheDocument();
  });

  it('shows "Good afternoon" between noon and 5pm', () => {
    renderGreeting('Jordan Rivera', 14);
    expect(screen.getByText('Good afternoon, Jordan')).toBeInTheDocument();
  });

  it('shows "Good evening" at/after 5pm', () => {
    renderGreeting('Jordan Rivera', 19);
    expect(screen.getByText('Good evening, Jordan')).toBeInTheDocument();
  });

  it('uses only the first name from a multi-word display name', () => {
    renderGreeting('Maria De La Cruz', 10);
    expect(screen.getByText('Good morning, Maria')).toBeInTheDocument();
  });

  it('falls back to a plain greeting with no name when displayName is empty', () => {
    renderGreeting('', 10);
    expect(screen.getByText('Good morning')).toBeInTheDocument();
  });

  it('never renders an email address or id as the greeting', () => {
    renderGreeting('Jordan Rivera', 10);
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.queryByText('staff-test')).not.toBeInTheDocument();
  });

  it('still renders the existing date/active-case subtitle unchanged', () => {
    renderGreeting('Jordan Rivera', 10);
    expect(screen.getByText('Thursday, January 1 · 5 active cases')).toBeInTheDocument();
  });
});
