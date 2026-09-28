import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

/**
 * Task #4 (2026-09) — Case Number and activity description are visually
 * too close together; separate them with real layout spacing (never
 * literal repeated spaces in the text itself). Structural-layout
 * assertions only — no pixel-specific checks.
 */
describe('RecentActivityPanel — Case Number / activity description spacing (Task #4, 2026-09)', () => {
  it('1/2. renders both the Case Number and the activity description', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-1', caseId: case_.id, description: 'Case updated' })],
      nextCursor: null,
    });
    const { container } = renderPanel();

    expect(await screen.findByText(case_.caseNumber)).toBeInTheDocument();
    expect(screen.getByText('Case updated')).toBeInTheDocument();
    void container;
  });

  it('3. Case Number and activity description are separate elements, not merged into one text node', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-2', caseId: case_.id, description: 'Case updated' })],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(case_.caseNumber);

    const caseNumberEl = container.querySelector('[class*="caseNumber"]')!;
    const whatEl = container.querySelector('[class*="what"]')!;
    expect(caseNumberEl).not.toBe(whatEl);
    expect(caseNumberEl.textContent).toBe(case_.caseNumber); // never merged with the description text
    expect(whatEl.textContent).toBe('Case updated');
    // No literal repeated-space hack anywhere in the text content — real
    // layout spacing (a `gap` on their shared flex parent, see
    // RecentActivityPanel.module.css's .rowMain) provides the separation
    // instead. Both elements share the same immediate parent, which
    // carries the layout class responsible for that spacing.
    const rowMain = caseNumberEl.parentElement!;
    expect(rowMain).toBe(whatEl.parentElement);
    expect(rowMain.className).toMatch(/rowMain/);
    expect(caseNumberEl.textContent).not.toMatch(/\s{2,}/);
  });

  it('4. the Case Number appears before the activity description in DOM order', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-3', caseId: case_.id, description: 'Case updated' })],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(case_.caseNumber);

    const caseNumberEl = container.querySelector('[class*="caseNumber"]')!;
    const whatEl = container.querySelector('[class*="what"]')!;
    expect(caseNumberEl.compareDocumentPosition(whatEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('5. no duplicate Case Number is introduced', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-4', caseId: case_.id, description: 'Case updated' })],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(case_.caseNumber);

    expect(container.querySelectorAll('[class*="caseNumber"]')).toHaveLength(1);
    // The case number text itself appears exactly once — no stray copy
    // baked into generated content anywhere in the row.
    expect(screen.getAllByText(case_.caseNumber)).toHaveLength(1);
  });

  it('6. the activity description text is exactly what was provided — unchanged by the layout change', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-5', caseId: case_.id, description: 'Payment recorded for $150.00' })],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByText('Payment recorded for $150.00')).toBeInTheDocument();
  });

  it('7. the existing timestamp ("time ago" text) remains present and unchanged', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-6', caseId: case_.id, createdAt: new Date(Date.now() - 5 * 60_000).toISOString() })],
      nextCursor: null,
    });
    renderPanel();
    await screen.findByText(case_.caseNumber);
    expect(screen.getByText('5 min ago')).toBeInTheDocument();
  });

  it('8. actor/attribution content is unaffected — this row never rendered actor text before, and still does not (Task #10 territory, untouched)', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-7', caseId: case_.id, actorIdentityId: 'identity-someone', description: 'Case updated' })],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(case_.caseNumber);
    expect(container.querySelectorAll('[class*="row"]').length).toBeGreaterThan(0);
    expect(screen.queryByText('identity-someone')).not.toBeInTheDocument();
  });

  it('9. no case-level navigation/link was added or removed — this row remains a plain (non-link) row, as before', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-8', caseId: case_.id, description: 'Case updated' })],
      nextCursor: null,
    });
    renderPanel();
    await screen.findByText(case_.caseNumber);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('10. multiple rows retain correct Case Number ↔ description association after the layout change', async () => {
    mockPermissions(['audit.read']);
    const [caseA, caseB] = caseFixtures;
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({ id: 'event-multi-a', caseId: caseA.id, description: 'Payment recorded' }),
        makeEvent({ id: 'event-multi-b', caseId: caseB.id, description: 'Task completed: Call family' }),
      ],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(caseA.caseNumber);

    // Direct children of the list container are exactly the row divs —
    // avoids a `[class*="row"]` substring match also picking up the
    // nested `.rowMain` wrapper.
    const rows = Array.from(container.querySelector('[class*="list"]')!.children);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText(caseA.caseNumber)).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Payment recorded')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText(caseB.caseNumber)).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Task completed: Call family')).toBeInTheDocument();
  });
});
