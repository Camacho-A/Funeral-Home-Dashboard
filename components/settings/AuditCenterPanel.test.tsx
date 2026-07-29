import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditCenterPanel } from './AuditCenterPanel';
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

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'event-1',
    eventVersion: 1,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: null,
    actorIdentityId: 'identity-1',
    actorMembershipId: null,
    actorRoleKey: 'administrator',
    category: 'payments',
    eventType: 'payment.recorded',
    resourceType: 'payment',
    resourceId: 'payment-1',
    previousValue: null,
    newValue: JSON.stringify({ amountCents: 89000 }),
    description: 'Payment of $890.00 recorded',
    metadata: null,
    severity: 'info',
    correlationId: null,
    isSystemGenerated: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <AuditCenterPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AuditCenterPanel — permission gating', () => {
  it("shows nothing to a role without audit.read (view is refused before any activity fetch happens)", async () => {
    mockPermissions([]);
    renderPanel();
    expect(await screen.findByText("You don't have access to the audit log for this organization.")).toBeInTheDocument();
    expect(activityClient.fetchOrganizationActivity).not.toHaveBeenCalled();
  });

  it('renders the filter bar and event list for a role with audit.read', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({ events: [makeEvent()], nextCursor: null });
    renderPanel();
    expect(await screen.findByText('Payment of $890.00 recorded')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
  });

  it('disables the Export CSV button for a role with audit.read but not audit.export', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({ events: [makeEvent()], nextCursor: null });
    renderPanel();
    await screen.findByText('Payment of $890.00 recorded');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });
});

describe('AuditCenterPanel — event list and detail', () => {
  beforeEach(() => {
    mockPermissions(['audit.read', 'audit.export']);
  });

  it('shows an empty state when no events match the current filters', async () => {
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({ events: [], nextCursor: null });
    renderPanel();
    expect(await screen.findByText('No activity matches these filters.')).toBeInTheDocument();
  });

  it('opens a detail view with the full event fields on row click', async () => {
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({ events: [makeEvent()], nextCursor: null });
    renderPanel();
    fireEvent.click(await screen.findByText('Payment of $890.00 recorded'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('payment.recorded')).toBeInTheDocument();
    expect(within(dialog).getByText('amountCents')).toBeInTheDocument();
  });

  it('loads the next page of organization-wide activity via cursor', async () => {
    vi.mocked(activityClient.fetchOrganizationActivity).mockImplementation(async (_orgId, _filters, cursor) => {
      if (!cursor) return { events: [makeEvent({ id: 'event-1', description: 'First event' })], nextCursor: 'cursor-2' };
      return { events: [makeEvent({ id: 'event-2', description: 'Second event' })], nextCursor: null };
    });
    renderPanel();
    await screen.findByText('First event');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Second event')).toBeInTheDocument();
    expect(screen.getByText('First event')).toBeInTheDocument();
  });

  it('navigates to the export URL with the current filters when Export CSV is clicked', async () => {
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({ events: [makeEvent()], nextCursor: null });
    const originalLocation = window.location;
    // @ts-expect-error — redefining window.location for a navigation assertion
    delete window.location;
    // @ts-expect-error — partial Location stand-in
    window.location = { href: '' };

    renderPanel();
    await screen.findByText('Payment of $890.00 recorded');

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'payments' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(window.location.href).toContain('/api/activity/export');
    expect(window.location.href).toContain('category=payments');

    // @ts-expect-error — restoring the real window.location
    window.location = originalLocation;
  });

  it('commits the free-text search only on submit, not on every keystroke', async () => {
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({ events: [makeEvent()], nextCursor: null });
    renderPanel();
    await screen.findByText('Payment of $890.00 recorded');
    const callsBeforeTyping = vi.mocked(activityClient.fetchOrganizationActivity).mock.calls.length;

    fireEvent.change(screen.getByLabelText('Search description'), { target: { value: 'refund' } });
    expect(vi.mocked(activityClient.fetchOrganizationActivity).mock.calls.length).toBe(callsBeforeTyping);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(activityClient.fetchOrganizationActivity).toHaveBeenLastCalledWith(DEFAULT_ORGANIZATION_ID, expect.objectContaining({ q: 'refund' }), null),
    );
  });
});
