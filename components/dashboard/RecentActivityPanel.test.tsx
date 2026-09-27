import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecentActivityPanel } from './RecentActivityPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as activityClient from '@/lib/activityClient';
import { casesService } from '@/services/casesService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
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

/**
 * Manors go-live improvement (2026-09) — Case Number next to each
 * case-related Recent Activity entry.
 */
describe('RecentActivityPanel — Case Number display (2026-09)', () => {
  it('1/2. displays the real Case.caseNumber for an activity with a matching caseId', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-case', caseId: case_.id, description: 'Payment recorded' })],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText(case_.caseNumber)).toBeInTheDocument();
    // 7. existing activity text is untouched, right alongside the number.
    expect(screen.getByText('Payment recorded')).toBeInTheDocument();
  });

  it('3. multiple activities for different cases each show their own respective Case Number', async () => {
    mockPermissions(['audit.read']);
    const [caseA, caseB] = caseFixtures;
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({ id: 'event-a', caseId: caseA.id, description: 'Payment recorded' }),
        makeEvent({ id: 'event-b', caseId: caseB.id, description: 'Task completed: Call family' }),
      ],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText(caseA.caseNumber)).toBeInTheDocument();
    expect(screen.getByText(caseB.caseNumber)).toBeInTheDocument();
    expect(caseA.caseNumber).not.toBe(caseB.caseNumber);
  });

  it('4. an activity with no caseId renders normally with no Case Number, and no placeholder text', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-no-case', caseId: null, description: 'Role permissions updated' })],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText('Role permissions updated')).toBeInTheDocument();
    for (const placeholder of ['N/A', 'Unknown', 'No Case', 'No case']) {
      expect(screen.queryByText(placeholder)).not.toBeInTheDocument();
    }
  });

  it('5/6. an activity whose caseId matches no known Case renders safely, with no raw id exposed and nothing guessed', async () => {
    mockPermissions(['audit.read']);
    const staleCaseId = 'case-does-not-exist-12345';
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-stale', caseId: staleCaseId, description: 'Case updated (weight)' })],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText('Case updated (weight)')).toBeInTheDocument();
    expect(screen.queryByText(staleCaseId)).not.toBeInTheDocument();
    expect(screen.queryByText(/^B\d{4}-/)).not.toBeInTheDocument(); // no fabricated case number
  });

  it('8. timestamps/user attribution (time-ago text) remain intact alongside the Case Number', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-time', caseId: case_.id, createdAt: new Date(Date.now() - 5 * 60_000).toISOString() })],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText(case_.caseNumber)).toBeInTheDocument();
    expect(screen.getByText('5 min ago')).toBeInTheDocument();
  });

  it('9. resolving Case Numbers never introduces a second network request, regardless of how many entries have a caseId', async () => {
    mockPermissions(['audit.read']);
    const listSpy = vi.spyOn(casesService, 'list');
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: caseFixtures.slice(0, 3).map((c, i) => makeEvent({ id: `event-${i}`, caseId: c.id })),
      nextCursor: null,
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText(caseFixtures[0].caseNumber)).toBeInTheDocument());
    expect(listSpy).toHaveBeenCalledTimes(1); // one bulk fetch, never one per activity row
    listSpy.mockRestore();
  });

  it("10. organization isolation — a caseId belonging to another organization's Case never resolves a number here", async () => {
    mockPermissions(['audit.read']);
    // Simulates a caseId genuinely outside this caller's authorized set —
    // useCases() only ever returns the current organization's own Cases
    // (see hooks/useCases.ts), so this caseId simply has no match, exactly
    // like the stale-reference case above — never a cross-org lookup.
    const otherOrgCaseId = 'case-from-another-organization';
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-other-org', caseId: otherOrgCaseId, description: 'Payment recorded' })],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText('Payment recorded')).toBeInTheDocument();
    expect(screen.queryByText(otherOrgCaseId)).not.toBeInTheDocument();
    for (const c of caseFixtures) {
      expect(screen.queryByText(c.caseNumber)).not.toBeInTheDocument();
    }
  });
});
