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
        <CaseActivityTab caseId="case-1" />
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

  it('renders each event\'s description and actor/timestamp', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({
      events: [makeEvent({ description: 'Stage changed to Service Scheduled' })],
      nextCursor: null,
    });
    renderTab();
    expect(await screen.findByText('Stage changed to Service Scheduled')).toBeInTheDocument();
    expect(screen.getByText(/administrator/)).toBeInTheDocument();
  });

  it('labels a system-generated event as "System" rather than a role key', async () => {
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({
      events: [makeEvent({ isSystemGenerated: true, actorRoleKey: null, actorIdentityId: null, description: 'Payment recorded' })],
      nextCursor: null,
    });
    renderTab();
    await screen.findByText('Payment recorded');
    expect(screen.getByText(/System/)).toBeInTheDocument();
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
});
