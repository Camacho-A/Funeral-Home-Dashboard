import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseActivityTab } from './CaseActivityTab';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as activityClient from '@/lib/activityClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { ActivityEvent } from '@/types/activityEvent';

vi.mock('@/lib/activityClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/activityClient')>('@/lib/activityClient');
  return { ...actual, fetchCaseActivity: vi.fn() };
});

const mockPrintTextLog = vi.fn();
vi.mock('@/utils/print', () => ({
  printTextLog: (...args: unknown[]) => mockPrintTextLog(...args),
}));

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'event-1',
    eventVersion: 1,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    actorIdentityId: 'identity-1',
    actorMembershipId: null,
    actorRoleKey: 'administrator',
    category: 'cases',
    eventType: 'case.updated',
    resourceType: 'case',
    resourceId: 'case-1',
    previousValue: null,
    newValue: null,
    description: 'Case updated',
    metadata: null,
    severity: 'info',
    correlationId: null,
    isSystemGenerated: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderTab() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <CaseActivityTab caseId="case-1" caseName="Jane Doe" caseNumber="B2026-001" />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CaseActivityTab', () => {
  it('shows an empty state when the case has no recorded activity', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({ events: [], nextCursor: null });
    renderTab();
    expect(await screen.findByText('No activity recorded for this case yet.')).toBeInTheDocument();
  });

  it('renders each event\'s description and actor/timestamp, using the friendly role label rather than the raw internal key', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({
      events: [makeEvent({ description: 'Stage changed to Service Scheduled' })],
      nextCursor: null,
    });
    renderTab();
    expect(await screen.findByText('Stage changed to Service Scheduled')).toBeInTheDocument();
    expect(screen.getByText(/Administrator/)).toBeInTheDocument();
    expect(screen.queryByText('administrator')).not.toBeInTheDocument();
  });

  it('item #16 — 1: labels an explicitly system-generated event as "System" rather than a role key', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({
      events: [makeEvent({ isSystemGenerated: true, actorRoleKey: null, actorIdentityId: null, description: 'Payment recorded' })],
      nextCursor: null,
    });
    renderTab();
    await screen.findByText('Payment recorded');
    expect(screen.getByText(/System/)).toBeInTheDocument();
  });

  it('item #16 — 2/3: a real Office Staff human action shows "Office Staff", not "System" and not raw "officeStaff"', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({
      events: [
        makeEvent({
          isSystemGenerated: false,
          actorRoleKey: 'officeStaff',
          description: 'Updated case information',
        }),
      ],
      nextCursor: null,
    });
    renderTab();
    await screen.findByText('Updated case information');
    expect(screen.getByText(/Office Staff/)).toBeInTheDocument();
    expect(screen.queryByText(/^System$/)).not.toBeInTheDocument();
    expect(screen.queryByText('officeStaff')).not.toBeInTheDocument();
  });

  it('item #16 — 6: missing actor information is not assumed to be System', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({
      events: [makeEvent({ isSystemGenerated: false, actorRoleKey: null, description: 'Case updated' })],
      nextCursor: null,
    });
    renderTab();
    await screen.findByText('Case updated');
    expect(screen.getByText(/Unknown/)).toBeInTheDocument();
  });

  it('expands a row with before/after values on click, and collapses it again', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({
      events: [
        makeEvent({
          description: 'Stage changed',
          previousValue: JSON.stringify({ stage: 'arrangement' }),
          newValue: JSON.stringify({ stage: 'service_scheduled' }),
        }),
      ],
      nextCursor: null,
    });
    renderTab();
    const row = await screen.findByText('Stage changed');
    expect(screen.queryByText('arrangement')).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(await screen.findByText('arrangement')).toBeInTheDocument();

    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByText('arrangement')).not.toBeInTheDocument());
  });

  it('does not render a row as clickable when there is nothing to expand', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({
      events: [makeEvent({ description: 'Task completed' })],
      nextCursor: null,
    });
    renderTab();
    await screen.findByText('Task completed');
    expect(screen.queryByRole('button', { name: /Task completed/ })).not.toBeInTheDocument();
  });

  it('loads the next page via cursor and appends events without duplicating the first page', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockImplementation(async (_caseId, _orgId, cursor) => {
      if (!cursor) return { events: [makeEvent({ id: 'event-1', description: 'First event' })], nextCursor: 'cursor-2' };
      return { events: [makeEvent({ id: 'event-2', description: 'Second event' })], nextCursor: null };
    });
    renderTab();
    await screen.findByText('First event');
    expect(screen.queryByText('Second event')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Second event')).toBeInTheDocument();
    expect(screen.getByText('First event')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  describe('item #2 — Activity tab Print (replaces the removed Overview ActivityLogCard print)', () => {
    it('7: offers a Print action', async () => {
      vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({
        events: [makeEvent({ description: 'Case updated' })],
        nextCursor: null,
      });
      renderTab();
      await screen.findByText('Case updated');
      expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
    });

    it('8: Print uses the real persisted ActivityEvent rows currently loaded — not buildTimeline/checklist-derived data', async () => {
      const events = [
        makeEvent({ id: 'event-1', description: 'Case updated', createdAt: '2026-08-01T00:00:00.000Z' }),
        makeEvent({ id: 'event-2', description: 'Payment recorded', isSystemGenerated: true, actorRoleKey: null, actorIdentityId: null, createdAt: '2026-08-02T00:00:00.000Z' }),
      ];
      vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({ events, nextCursor: null });
      renderTab();
      await screen.findByText('Case updated');

      fireEvent.click(screen.getByRole('button', { name: 'Print' }));

      expect(mockPrintTextLog).toHaveBeenCalledTimes(1);
      const [title, caseName, caseNumber, printedEvents] = mockPrintTextLog.mock.calls[0];
      expect(title).toBe('Case Activity');
      expect(caseName).toBe('Jane Doe');
      expect(caseNumber).toBe('B2026-001');
      // The exact array reference passed to printTextLog is the same
      // `events` this component derived from useCaseActivity's pages —
      // never a separately-built buildTimeline `{who, what, daysAgo}` shape.
      expect(printedEvents).toEqual(events);
      expect(printedEvents[0]).not.toHaveProperty('who');
      expect(printedEvents[0]).not.toHaveProperty('what');
      expect(printedEvents[0]).not.toHaveProperty('daysAgo');
    });

    it('preserves 35e4c1c actor formatting in the printed row: system -> "System", human role -> friendly label, never raw officeStaff', async () => {
      const events = [
        makeEvent({ id: 'event-1', description: 'Payment recorded', isSystemGenerated: true, actorRoleKey: null, actorIdentityId: null, createdAt: '2026-08-01T00:00:00.000Z' }),
        makeEvent({ id: 'event-2', description: 'Updated case information', isSystemGenerated: false, actorRoleKey: 'officeStaff', createdAt: '2026-08-02T00:00:00.000Z' }),
      ];
      vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({ events, nextCursor: null });
      renderTab();
      await screen.findByText('Payment recorded');

      fireEvent.click(screen.getByRole('button', { name: 'Print' }));

      const [, , , , renderEntry] = mockPrintTextLog.mock.calls[0];
      const systemRow = renderEntry(events[0]);
      const humanRow = renderEntry(events[1]);

      expect(systemRow).toContain('System');
      expect(systemRow).toContain('Payment recorded');
      expect(systemRow).not.toContain('Office');

      expect(humanRow).toContain('Office Staff');
      expect(humanRow).not.toContain('officeStaff');
      expect(humanRow).not.toMatch(/>\s*System\s*</);
    });
  });
});
