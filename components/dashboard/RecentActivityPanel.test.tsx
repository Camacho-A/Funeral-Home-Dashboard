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
import type { ActivityEventWithActor } from '@/services/activityService';

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

/** `actorDisplayName` defaults to `null` (not a hardcoded person) so
    existing tests that don't care about actor attribution keep seeing the
    pre-existing role-label fallback ("Administrator", from `actorRoleKey`
    below) via `activityActorLabel` — exactly what a real, resolvable-name
    caller sees is exercised by the dedicated actor-attribution describe
    block further down, which sets `actorDisplayName` explicitly. */
function makeEvent(overrides: Partial<ActivityEventWithActor> = {}): ActivityEventWithActor {
  return {
    id: 'event-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    eventVersion: 1,
    caseId: null,
    actorIdentityId: 'identity-1',
    actorMembershipId: null,
    actorRoleKey: 'administrator',
    actorDisplayName: null,
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
    expect(screen.getByText(/5 min ago/)).toBeInTheDocument();
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
    // layout spacing (a `gap` on their shared `.rowMain` flex wrapper, see
    // RecentActivityPanel.module.css) provides the separation instead.
    // Both elements share the same immediate parent.
    const rowEl = caseNumberEl.parentElement!;
    expect(rowEl).toBe(whatEl.parentElement);
    expect(rowEl.className).toMatch(/row/);
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
    expect(screen.getByText(/5 min ago/)).toBeInTheDocument();
  });

  it('8. actor attribution never exposes the raw identityId, even when a resolved name is present (superseded by the dedicated actor-attribution suite below, Recent Activity name fix, 2026-09)', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-7', caseId: case_.id, actorIdentityId: 'identity-someone', actorDisplayName: 'Jane Smith', description: 'Case updated' })],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(case_.caseNumber);
    expect(container.querySelectorAll('[class*="row"]').length).toBeGreaterThan(0);
    expect(screen.queryByText('identity-someone')).not.toBeInTheDocument();
    expect(screen.getByText(/Jane Smith/)).toBeInTheDocument();
  });

  it('9. a case-related row is rendered as a navigable link (Recent Activity case navigation, 2026-10 — supersedes the prior "remains a plain row" expectation)', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-spacing-8', caseId: case_.id, description: 'Case updated' })],
      nextCursor: null,
    });
    renderPanel();
    await screen.findByText(case_.caseNumber);
    expect(screen.queryAllByRole('link')).toHaveLength(1);
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

/**
 * Task #4 follow-up (2026-09) — a document's internal UUID was leaking
 * into this panel via document.regenerated's description text
 * ("Document regenerated (supersedes <uuid>)"). Covers both a clean
 * future event and a legacy row that still has the UUID baked into its
 * persisted description (see domain/activity/activityDisplay.ts).
 */
describe('RecentActivityPanel — no internal ids in Recent Activity (Task #4 follow-up, 2026-09)', () => {
  it('1/2. a document.regenerated event displays "Document regenerated" with no UUID present', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-doc-regen',
          caseId: case_.id,
          eventType: 'document.regenerated',
          description: 'Document regenerated',
        }),
      ],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText('Document regenerated')).toBeInTheDocument();
    expect(screen.queryByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/supersedes/i)).not.toBeInTheDocument();
  });

  it('3. a legacy document.regenerated row with the UUID already baked into its persisted description displays safely', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-doc-regen-legacy',
          caseId: case_.id,
          eventType: 'document.regenerated',
          description: 'Document regenerated (supersedes 1d13e80e-4e3b-4c1e-8052-2503785baec5)',
        }),
      ],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText('Document regenerated')).toBeInTheDocument();
    expect(screen.queryByText(/1d13e80e-4e3b-4c1e-8052-2503785baec5/)).not.toBeInTheDocument();
    expect(screen.queryByText(/supersedes/i)).not.toBeInTheDocument();
  });

  it('6/7. Case Number still renders and the timestamp is unchanged alongside the safe document.regenerated text', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-doc-regen-meta',
          caseId: case_.id,
          eventType: 'document.regenerated',
          description: 'Document regenerated (supersedes 1d13e80e-4e3b-4c1e-8052-2503785baec5)',
          createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        }),
      ],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText(case_.caseNumber)).toBeInTheDocument();
    expect(screen.getByText(/5 min ago/)).toBeInTheDocument();
  });

  it('7. Task #4 layout separation remains intact for a document.regenerated row (case number + gap + description, no merged text node)', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-doc-regen-layout',
          caseId: case_.id,
          eventType: 'document.regenerated',
          description: 'Document regenerated (supersedes 1d13e80e-4e3b-4c1e-8052-2503785baec5)',
        }),
      ],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(case_.caseNumber);

    const caseNumberEl = container.querySelector('[class*="caseNumber"]')!;
    const whatEl = container.querySelector('[class*="what"]')!;
    expect(whatEl.textContent).toBe('Document regenerated');
    const rowEl = caseNumberEl.parentElement!;
    expect(rowEl).toBe(whatEl.parentElement);
    expect(rowEl.className).toMatch(/row/);
  });

  it('9. an ordinary, non-document.regenerated activity description is completely unaffected', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-ordinary', description: 'Payment recorded for $150.00' })],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByText('Payment recorded for $150.00')).toBeInTheDocument();
  });

  it('10/11. no duplicate rows are introduced, and no Blob URL/storage key is ever exposed for a document.regenerated entry', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-doc-regen-dup',
          caseId: case_.id,
          eventType: 'document.regenerated',
          description: 'Document regenerated (supersedes 1d13e80e-4e3b-4c1e-8052-2503785baec5)',
        }),
      ],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText('Document regenerated');

    const rows = Array.from(container.querySelector('[class*="list"]')!.children);
    expect(rows).toHaveLength(1);
    expect(screen.getAllByText('Document regenerated')).toHaveLength(1);
    expect(screen.queryByText(/blob\.vercel-storage\.com/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^https?:\/\//)).not.toBeInTheDocument();
  });
});

/**
 * Recent Activity case navigation (2026-10). Each case-related row is now
 * clickable, navigating to that case's Case Detail page at `/cases/{id}`
 * (the same canonical route AllCasesList/NeedsAttentionPanel/
 * StageFilteredPanel already use — a stable Case `id`, never a case number
 * reconstructed into a URL). An activity with no resolvable case
 * destination (no caseId, or a caseId outside this organization's
 * authorized Case list) stays a plain, non-interactive row.
 */
describe('RecentActivityPanel — case navigation (2026-10)', () => {
  it('a case-related row renders as a link to that case\'s Case Detail page, using the Case id (not the case number) in the href', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-nav-1', caseId: case_.id, description: 'Document downloaded' })],
      nextCursor: null,
    });
    renderPanel();

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', `/cases/${case_.id}`);
    expect(link.getAttribute('href')).not.toContain(case_.caseNumber);
  });

  it('the entire row — case number, description, actor, and timestamp — is inside the single clickable link, not just the case number text', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-nav-2', caseId: case_.id, actorDisplayName: 'Angelica Camacho', description: 'Document downloaded' })],
      nextCursor: null,
    });
    renderPanel();

    const link = await screen.findByRole('link');
    expect(within(link).getByText(case_.caseNumber)).toBeInTheDocument();
    expect(within(link).getByText('Document downloaded')).toBeInTheDocument();
    expect(within(link).getByText(/Angelica Camacho/)).toBeInTheDocument();
  });

  it('the link is reachable and operable via the keyboard (a real <a href>, not a div with an onClick handler)', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-nav-3', caseId: case_.id, description: 'Document downloaded' })],
      nextCursor: null,
    });
    renderPanel();

    const link = await screen.findByRole('link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href');
    link.focus();
    expect(link).toHaveFocus();
  });

  it('an activity with no caseId at all remains a plain, non-interactive row (no link)', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-nav-4', caseId: null, description: 'Role permissions updated' })],
      nextCursor: null,
    });
    renderPanel();

    await screen.findByText('Role permissions updated');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('an activity whose caseId does not resolve to an authorized Case (stale or cross-org) stays non-clickable — never a fabricated or unauthorized URL', async () => {
    mockPermissions(['audit.read']);
    const staleCaseId = 'case-does-not-exist-12345';
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-nav-5', caseId: staleCaseId, description: 'Case updated (weight)' })],
      nextCursor: null,
    });
    renderPanel();

    await screen.findByText('Case updated (weight)');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('multiple rows mix correctly: case-related rows are links, non-case rows are not, each wired to its own case', async () => {
    mockPermissions(['audit.read']);
    const [caseA, caseB] = caseFixtures;
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({ id: 'event-nav-mix-a', caseId: caseA.id, description: 'Payment recorded' }),
        makeEvent({ id: 'event-nav-mix-none', caseId: null, description: 'Role permissions updated' }),
        makeEvent({ id: 'event-nav-mix-b', caseId: caseB.id, description: 'Task completed: Call family' }),
      ],
      nextCursor: null,
    });
    renderPanel();

    await screen.findByText('Payment recorded');
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.getAttribute('href')).sort()).toEqual([`/cases/${caseA.id}`, `/cases/${caseB.id}`].sort());
    expect(screen.getByText('Role permissions updated').closest('a')).toBeNull();
  });
});

/**
 * Recent Activity actor-attribution fix (2026-09) — Dashboard → Recent
 * Activity previously showed no actor information at all; the request was
 * to answer "who actually did this" with the employee's real full name
 * (never a role, never the current viewer, never a raw id), falling back
 * to "System" only for genuine system events and to the pre-existing role
 * label / "Unknown" only when no name can be resolved. `actorDisplayName`
 * is resolved server-side per request (see
 * `services/activityService.ts#attachActorDisplayNames`) — these tests
 * exercise the component's rendering of whatever the (mocked) fetch
 * already returned, i.e. they hold `actorDisplayName` fixed per-event to
 * simulate what a real resolved/unresolved response looks like.
 */
describe('RecentActivityPanel — actual employee name attribution (Recent Activity, 2026-09)', () => {
  it('1. a human activity displays the actual employee full name', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-actor-1', actorDisplayName: 'Angelica Camacho', description: 'Document downloaded' })],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByText(/Angelica Camacho/)).toBeInTheDocument();
  });

  it('2/3. does not display "Admin" or "Administrator" in place of the actor when the employee\'s full name is available', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-actor-2', actorRoleKey: 'administrator', actorDisplayName: 'Angelica Camacho', description: 'Document downloaded' })],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByText(/Angelica Camacho/)).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Administrator')).not.toBeInTheDocument();
  });

  it('4/18. multiple rows with different employees each render their own respective name, correctly associated', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({ id: 'event-actor-jane', actorIdentityId: 'identity-jane', actorDisplayName: 'Jane Smith', description: 'Case updated' }),
        makeEvent({ id: 'event-actor-john', actorIdentityId: 'identity-john', actorDisplayName: 'John Doe', description: 'Payment recorded' }),
      ],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(/Jane Smith/);

    const rows = Array.from(container.querySelector('[class*="list"]')!.children) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Case updated')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Jane Smith/)).toBeInTheDocument();
    expect(within(rows[0]).queryByText(/John Doe/)).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('Payment recorded')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/John Doe/)).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/Jane Smith/)).not.toBeInTheDocument();
  });

  it('5. a genuinely system-generated event displays "System", never a name or role', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-actor-system',
          isSystemGenerated: true,
          actorIdentityId: null,
          actorRoleKey: null,
          actorDisplayName: null,
          description: 'Reminder sent',
        }),
      ],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByText(/System/)).toBeInTheDocument();
  });

  it('6. a failed/missing actor-name lookup on a human event is never falsely labeled as another employee or as System', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-actor-unresolved',
          isSystemGenerated: false,
          actorIdentityId: 'identity-deleted',
          actorRoleKey: null,
          actorDisplayName: null,
          description: 'Case updated',
        }),
      ],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByText(/Unknown/)).toBeInTheDocument();
    expect(screen.queryByText(/System/)).not.toBeInTheDocument();
    expect(screen.queryByText('identity-deleted')).not.toBeInTheDocument();
  });

  it('7. the current Dashboard viewer is never substituted as another event\'s historical actor', async () => {
    // mockPermissions below is the CURRENT VIEWER's own identity — the
    // rendered event belongs to a different person entirely. This panel
    // has no code path that reads the viewer's own session/name at all
    // (unlike TopBar's useSession()), so there is nothing for it to
    // substitute — this test guards against a future regression wiring
    // one in.
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-actor-historical',
          actorIdentityId: 'identity-someone-else',
          actorDisplayName: 'Someone Else',
          description: 'Case updated',
        }),
      ],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByText(/Someone Else/)).toBeInTheDocument();
    expect(screen.queryByText(/identity-1/)).not.toBeInTheDocument();
  });

  it('9. a legacy event with genuinely insufficient actor information (no name, no role) falls back to "Unknown"', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-actor-legacy-insufficient',
          actorIdentityId: null,
          actorRoleKey: null,
          actorDisplayName: null,
          isSystemGenerated: false,
          description: 'Case updated',
        }),
      ],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByText(/Unknown/)).toBeInTheDocument();
  });

  it('10/11. no user/identity id or UUID is ever displayed as the actor, even when one is present on the event', async () => {
    mockPermissions(['audit.read']);
    const rawIdentityId = 'a1b2c3d4-5e6f-4789-90ab-cdef01234567';
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [
        makeEvent({
          id: 'event-actor-rawid',
          actorIdentityId: rawIdentityId,
          actorDisplayName: 'Jane Smith',
          description: 'Case updated',
        }),
      ],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByText(/Jane Smith/)).toBeInTheDocument();
    expect(screen.queryByText(rawIdentityId)).not.toBeInTheDocument();
    expect(screen.queryByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)).not.toBeInTheDocument();
  });

  it('17. Task #4 layout separation remains intact with the new actor line present', async () => {
    mockPermissions(['audit.read']);
    const case_ = caseFixtures[0];
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-actor-layout', caseId: case_.id, actorDisplayName: 'Angelica Camacho', description: 'Case updated' })],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(case_.caseNumber);

    const caseNumberEl = container.querySelector('[class*="caseNumber"]')!;
    const whatEl = container.querySelector('[class*="what"]')!;
    const rowEl = caseNumberEl.parentElement!;
    expect(rowEl).toBe(whatEl.parentElement);
    expect(rowEl.className).toMatch(/row/);
    expect(caseNumberEl.textContent).toBe(case_.caseNumber);
    expect(whatEl.textContent).toBe('Case updated');

    // `.when` (actor · time) is a sibling of `.rowMain` (case number +
    // description) under the same outer row — not nested inside it.
    const whenEl = container.querySelector('[class*="when"]')!;
    expect(whenEl.textContent).toMatch(/Angelica Camacho/);
    expect(whenEl.parentElement).toBe(rowEl.parentElement);
  });
});

/**
 * SOLIS true redesign, Phase 1 — visual fidelity correction (2026-10).
 * The glyph is a CSS `::before` pseudo-element keyed on a `data-kind`
 * attribute (RecentActivityPanel.module.css) rather than a rendered DOM
 * node — these tests cover the classification, not the pseudo-element
 * itself (jsdom doesn't render `content`, so that part is covered by
 * this phase's own live-browser verification).
 */
describe('RecentActivityPanel — glyph classification via data-kind (SOLIS true redesign, Phase 1, visual fidelity correction)', () => {
  it.each([
    ['Document downloaded', 'download'],
    ['Document regenerated', 'regenerate'],
    ['Document uploaded: contract.pdf', 'upload'],
    ['Payment recorded for $150.00', 'payment'],
    ['Checklist updated', 'checklist'],
  ])('description %s gets data-kind=%s', async (description, kind) => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: `event-kind-${kind}`, description })],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText(description);
    expect(container.querySelector(`[data-kind="${kind}"]`)).not.toBeNull();
  });

  it('an unmatched description renders no data-kind attribute at all, falling back to the CSS default glyph', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-kind-none', description: 'Role permissions updated' })],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText('Role permissions updated');
    const row = container.querySelector('[class*="list"]')!.children[0] as HTMLElement;
    expect(row.hasAttribute('data-kind')).toBe(false);
  });

  it('"Case updated (checklistState)" is first relabeled "Checklist updated", then classified as checklist — the mapping and the glyph never disagree', async () => {
    mockPermissions(['audit.read']);
    vi.mocked(activityClient.fetchOrganizationActivity).mockResolvedValue({
      events: [makeEvent({ id: 'event-kind-mapped', description: 'Case updated (checklistState)' })],
      nextCursor: null,
    });
    const { container } = renderPanel();
    await screen.findByText('Checklist updated');
    expect(container.querySelector('[data-kind="checklist"]')).not.toBeNull();
  });
});
