import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TopBar } from './TopBar';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { SessionProvider } from '@/hooks/useSession';

/**
 * Manors go-live fix (real session identity). TopBar's avatar/signed-in
 * display must reflect whatever SessionProvider actually supplies — never
 * a hardcoded fixture like "Dana" — since that hardcoding was the exact,
 * disclosed production bug this task fixes (every real Manors employee
 * saw "Dana" as their own avatar regardless of who was actually logged
 * in). The test session below deliberately uses a name that matches no
 * services/__mocks__/fixtures.ts staff record, so a pass here can only
 * mean the value came from SessionProvider, not from any fixture.
 *
 * TopBar also calls useOrganizationRecord()/useMyPermissions()/
 * useUnreadNotificationCount()/useMyMemberships() — all real `fetch`-based
 * hooks regardless of OrganizationProvider's dataAdapterMode (see each
 * service's own comment on why). A single generic fetch stub satisfies
 * every one of their expected response shapes at once; none of their
 * resolved data affects the assertion this file cares about.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    }),
  );
});

const TEST_SESSION = { staffId: 'staff-test-session', displayName: 'Jordan Rivera' };

function renderTopBar() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <SessionProvider value={TEST_SESSION}>
          <TopBar />
        </SessionProvider>
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('TopBar — real session identity (Manors go-live fix)', () => {
  it('displays the authenticated employee from SessionProvider, not a hardcoded fixture', () => {
    renderTopBar();
    expect(screen.getByText('JO')).toBeInTheDocument();
    expect(screen.queryByText('DA')).not.toBeInTheDocument();
  });

  it('reflects a different SessionProvider value on a subsequent render', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider>
          <SessionProvider value={{ staffId: 'staff-other', displayName: 'Priya Nair' }}>
            <TopBar />
          </SessionProvider>
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('PR')).toBeInTheDocument();
  });
});

describe('TopBar — Case Numbering navigation visibility (2026-09 RBAC restriction)', () => {
  it('shows the Case Numbering link when the caller effectively holds caseNumber.manage (Administrator/Funeral Director)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ organization: null, permissions: ['caseNumber.manage'], count: 0, organizations: [] }),
      }),
    );
    renderTopBar();
    // findByText waits for useMyPermissions' async fetch to resolve and the
    // component to re-render — a synchronous getByText/queryByText here
    // would pass vacuously before the query settles.
    expect(await screen.findByText('Case Numbering')).toBeInTheDocument();
  });

  it('hides the Case Numbering link for every other role (no caseNumber.manage)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar();
    // Wait for the actual permissions fetch to have resolved (not just a
    // synchronous vacuous pass before react-query settles), then flush the
    // resulting re-render before asserting absence.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText('Case Numbering')).not.toBeInTheDocument();
  });

  it('does not show Case Numbering merely from holding organization.manage — the two are no longer the same gate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: ['organization.manage'], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText('Case Numbering')).not.toBeInTheDocument();
  });
});
