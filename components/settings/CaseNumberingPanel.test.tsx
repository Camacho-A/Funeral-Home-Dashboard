import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseNumberingPanel } from './CaseNumberingPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';

/**
 * Manors RBAC bootstrap fix (2026-09). See CaseNumberingPanel.tsx's own
 * doc comment for the bug this file guards against: the migration control
 * must render independently of the normal `caseNumber.manage`-gated
 * content's own loading/error state, since before the migration runs that
 * content's endpoint 403s by construction.
 */

const ELIGIBILITY_BODY = {
  organizationId: 'managed-cremations',
  year: 2026,
  targetNextSequence: 36,
  historicalCaseNumbers: ['B2026-034', 'B2026-035'],
  firstNormalCaseNumber: 'B2026-036',
  eligible: false,
  reason: null,
  currentNextSequence: 36,
};

/** Case-number sequence resync (2026-10) — the real live lag: the counter
    is queued at B2026-036 but that case already exists. */
const RESYNC_NEEDED_BODY = {
  organizationId: 'managed-cremations',
  year: 2026,
  currentNextSequence: 36,
  targetNextSequence: 37,
  currentCaseNumber: 'B2026-036',
  targetCaseNumber: 'B2026-037',
  needsResync: true,
  collidingCaseNumbers: ['B2026-036'],
  reason: null,
};

const RESYNC_NOT_NEEDED_BODY = { ...RESYNC_NEEDED_BODY, needsResync: false, reason: 'The 2026 sequence is already correct — B2026-037 is not in use.' };

function mockFetchFor(options: {
  permissions: string[];
  eligibilityStatus?: number;
  eligibilityBody?: Record<string, unknown>;
  migrationStatus?: number;
  migrationBody?: Record<string, unknown>;
  resyncStatus?: number;
  resyncBody?: Record<string, unknown>;
  resyncPostStatus?: number;
  resyncPostBody?: Record<string, unknown>;
}) {
  const {
    permissions,
    eligibilityStatus = 403,
    eligibilityBody = { error: 'Not authorized.' },
    migrationStatus = 200,
    migrationBody = { organizationId: 'managed-cremations', applicable: true, needsMigration: true, administratorGranted: false, funeralDirectorGranted: false },
    resyncStatus = 200,
    resyncBody = RESYNC_NOT_NEEDED_BODY,
    resyncPostStatus = 200,
    resyncPostBody = { organizationId: 'managed-cremations', year: 2026, nextSequence: 37, nextCaseNumber: 'B2026-037' },
  } = options;

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/rbac/my-permissions')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ organization: null, permissions, count: 0, organizations: [] }) });
    }
    if (url.includes('/api/organization/case-sequence/manors-go-live-cutover')) {
      return Promise.resolve({ ok: eligibilityStatus < 400, status: eligibilityStatus, json: async () => eligibilityBody });
    }
    if (url.includes('/api/organization/case-sequence/resync')) {
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: resyncPostStatus < 400, status: resyncPostStatus, json: async () => resyncPostBody });
      }
      return Promise.resolve({ ok: resyncStatus < 400, status: resyncStatus, json: async () => resyncBody });
    }
    if (url.includes('/api/organization/rbac/seed-case-number-manage')) {
      return Promise.resolve({ ok: migrationStatus < 400, status: migrationStatus, json: async () => migrationBody });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

function renderPanel() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <CaseNumberingPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('CaseNumberingPanel — Administrator bootstrap state (user.manageRoles, no caseNumber.manage yet)', () => {
  it('B/C: shows "Enable Case Numbering Access" even though the cutover eligibility endpoint 403s (caseNumber.manage not live yet)', async () => {
    const fetchMock = mockFetchFor({ permissions: ['user.manageRoles'] });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Enable Case Numbering Access' })).toBeInTheDocument();
  });

  it('D: does not expose normal Case Numbering management content in the bootstrap state', async () => {
    const fetchMock = mockFetchFor({ permissions: ['user.manageRoles'] });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await screen.findByRole('button', { name: 'Enable Case Numbering Access' });
    expect(screen.getByText('Case Numbering access must be enabled before this section is available.')).toBeInTheDocument();
    expect(screen.queryByText(/Next Case Number:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Prepare SOLIS Case Numbering')).not.toBeInTheDocument();
    // The raw eligibility-endpoint error text is never surfaced directly.
    expect(screen.queryByText('Not authorized.')).not.toBeInTheDocument();
  });

  it('does not show the migration control once needsMigration is false', async () => {
    const fetchMock = mockFetchFor({
      permissions: ['user.manageRoles'],
      migrationBody: { organizationId: 'managed-cremations', applicable: true, needsMigration: false, administratorGranted: true, funeralDirectorGranted: true },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Enable Case Numbering Access' })).not.toBeInTheDocument();
  });
});

describe('CaseNumberingPanel — after caseNumber.manage is granted', () => {
  it('E: Administrator (caseNumber.manage + user.manageRoles, migration already done) sees normal content, not the migration box', async () => {
    const fetchMock = mockFetchFor({
      permissions: ['caseNumber.manage', 'user.manageRoles'],
      eligibilityStatus: 200,
      eligibilityBody: ELIGIBILITY_BODY,
      migrationBody: { organizationId: 'managed-cremations', applicable: true, needsMigration: false, administratorGranted: true, funeralDirectorGranted: true },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    expect(await screen.findByText(/Next Case Number:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable Case Numbering Access' })).not.toBeInTheDocument();
    expect(screen.queryByText('Case Numbering access must be enabled before this section is available.')).not.toBeInTheDocument();
  });

  it('G/H: Funeral Director (caseNumber.manage only, no user.manageRoles) sees normal content and never sees the migration control', async () => {
    const fetchMock = mockFetchFor({
      permissions: ['caseNumber.manage'],
      eligibilityStatus: 200,
      eligibilityBody: ELIGIBILITY_BODY,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    expect(await screen.findByText(/Next Case Number:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable Case Numbering Access' })).not.toBeInTheDocument();
    // The migration-status endpoint is never even queried for a caller
    // without user.manageRoles.
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/organization/rbac/seed-case-number-manage'))).toBe(false);
  });
});

describe('CaseNumberingPanel — unauthorized direct-URL access', () => {
  it('N: a caller with neither caseNumber.manage nor user.manageRoles sees a generic access message, no protected data, no migration control', async () => {
    const fetchMock = mockFetchFor({ permissions: ['case.read'] });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    expect(await screen.findByText("You don't have access to Case Numbering.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable Case Numbering Access' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Next Case Number:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Case Numbering access must be enabled before this section is available.')).not.toBeInTheDocument();
  });
});

describe('CaseNumberingPanel — no mutation merely from rendering', () => {
  it('Q/R: rendering/loading the page in every permission state never issues a POST (no RBAC grant, no caseSequences mutation)', async () => {
    for (const permissions of [['user.manageRoles'], ['caseNumber.manage'], ['caseNumber.manage', 'user.manageRoles'], []]) {
      const fetchMock = mockFetchFor({ permissions });
      vi.stubGlobal('fetch', fetchMock);
      renderPanel();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await act(async () => {});
      expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit | undefined)?.method === undefined || (call[1] as RequestInit).method === 'GET')).toBe(true);
    }
  });
});

/**
 * Case-number sequence resync (2026-10). The lag this surfaces is the
 * real live defect: a historical Jotform import preserves its own number
 * and never advances the counter, so the counter can end up queued on a
 * number that already belongs to a case.
 */
describe('CaseNumberingPanel — case-number sequence resync', () => {
  const AUTHORIZED = {
    permissions: ['caseNumber.manage'],
    eligibilityStatus: 200,
    eligibilityBody: ELIGIBILITY_BODY,
  };

  it('renders nothing about resyncing when the counter is correct', async () => {
    const fetchMock = mockFetchFor({ ...AUTHORIZED, resyncBody: RESYNC_NOT_NEEDED_BODY });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await screen.findByText(/Next Case Number:/);
    await act(async () => {});
    expect(screen.queryByText('Case numbering needs attention')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct the next case number' })).not.toBeInTheDocument();
  });

  it('surfaces the lag and names both the colliding and the corrected number', async () => {
    const fetchMock = mockFetchFor({ ...AUTHORIZED, resyncBody: RESYNC_NEEDED_BODY });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    expect(await screen.findByText('Case numbering needs attention')).toBeInTheDocument();
    expect(screen.getByText(/Case B2026-036 already exists/)).toBeInTheDocument();
    expect(screen.getByText(/make B2026-037 the next number/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Correct the next case number' })).toBeInTheDocument();
  });

  it('never POSTs merely from rendering the lag — the action is confirmation-gated', async () => {
    const fetchMock = mockFetchFor({ ...AUTHORIZED, resyncBody: RESYNC_NEEDED_BODY });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await screen.findByRole('button', { name: 'Correct the next case number' });
    await act(async () => {});
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit | undefined)?.method === undefined)).toBe(true);
  });

  it('confirming sends a POST with no sequence value in the body and reports the new number', async () => {
    const fetchMock = mockFetchFor({ ...AUTHORIZED, resyncBody: RESYNC_NEEDED_BODY });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct the next case number' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/case-sequence/resync') && (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(true),
    );

    const postCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/case-sequence/resync') && (call[1] as RequestInit | undefined)?.method === 'POST')!;
    const sentBody = JSON.parse((postCall[1] as RequestInit).body as string);
    // The target is computed server-side — the client must never send one.
    expect(sentBody).toEqual({ organizationId: 'managed-cremations' });
    expect(sentBody.nextSequence).toBeUndefined();

    expect(await screen.findByText(/The next new SOLIS case will be B2026-037/)).toBeInTheDocument();
  });

  it('surfaces a failed correction as an error instead of claiming success', async () => {
    const fetchMock = mockFetchFor({
      ...AUTHORIZED,
      resyncBody: RESYNC_NEEDED_BODY,
      resyncPostStatus: 409,
      resyncPostBody: { error: 'Nothing to resync.', needsResync: false },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct the next case number' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing to resync.');
    expect(screen.queryByText(/The next new SOLIS case will be/)).not.toBeInTheDocument();
  });

  it('stays silent when the resync check itself is unavailable — it is a secondary check', async () => {
    const fetchMock = mockFetchFor({ ...AUTHORIZED, resyncStatus: 500, resyncBody: { error: 'boom' } });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await screen.findByText(/Next Case Number:/);
    await act(async () => {});
    expect(screen.queryByText('Case numbering needs attention')).not.toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
  });

  it('is never queried for a caller without caseNumber.manage', async () => {
    const fetchMock = mockFetchFor({ permissions: ['case.read'] });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await screen.findByText("You don't have access to Case Numbering.");
    await act(async () => {});
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/case-sequence/resync'))).toBe(false);
  });
});
