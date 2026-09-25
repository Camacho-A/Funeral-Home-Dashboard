import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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

function mockFetchFor(options: {
  permissions: string[];
  eligibilityStatus?: number;
  eligibilityBody?: Record<string, unknown>;
  migrationStatus?: number;
  migrationBody?: Record<string, unknown>;
}) {
  const {
    permissions,
    eligibilityStatus = 403,
    eligibilityBody = { error: 'Not authorized.' },
    migrationStatus = 200,
    migrationBody = { organizationId: 'managed-cremations', applicable: true, needsMigration: true, administratorGranted: false, funeralDirectorGranted: false },
  } = options;

  return vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/rbac/my-permissions')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ organization: null, permissions, count: 0, organizations: [] }) });
    }
    if (url.includes('/api/organization/case-sequence/manors-go-live-cutover')) {
      return Promise.resolve({ ok: eligibilityStatus < 400, status: eligibilityStatus, json: async () => eligibilityBody });
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
