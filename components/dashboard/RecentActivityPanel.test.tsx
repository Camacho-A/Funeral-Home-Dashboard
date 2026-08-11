import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecentActivityPanel } from './RecentActivityPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as activityClient from '@/lib/activityClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { ActivityEvent } from '@/types/activityEvent';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/activityClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/activityClient')>('@/lib/activityClient');
  return { ...actual, fetchOrganizationActivity: vi.fn() };
});

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'event-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    eventVersion: 1,
    caseId: null,
    actorIdentityId: 'identity-1',
    actorMembershipId: null,
    actorRoleKey: 'administrator',
    category: 'cases',
    eventType: 'case.created',
    correlationId: 'correlation-1',
    previousValue: null,
    newValue: null,
    description: 'Created a new case for Robert Ellison',
    metadata: null,
    severity: 'info',
    resourceType: 'case',
    resourceId: 'case-1',
    isSystemGenerated: false,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <RecentActivityPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('RecentActivityPanel', () => {
  it('renders nothing for a caller without audit.read', async () => {
    mockPermissions(['report.view']);
    const { container } = renderPanel();
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(activityClient.fetchOrganizationActivity).not.toHaveBeenCalled();
  });

  it('renders real activity events (not the old static fixture) for a caller with audit.read', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({ events: [makeEvent()], nextCursor: null });
    renderPanel();
    expect(await screen.findByText('Created a new case for Robert Ellison')).toBeInTheDocument();
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
  });

  it('shows an empty message when there is no activity yet', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({ events: [], nextCursor: null });
    renderPanel();
    expect(await screen.findByText('No recent activity.')).toBeInTheDocument();
  });
});
