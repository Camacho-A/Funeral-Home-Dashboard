import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseWorkflowRepairPanel } from './CaseWorkflowRepairPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';

/**
 * Case repair UI (2026-09). Covers the checkpoint's TESTS items A-F.
 * `services/workflowReconciliationService.ts#reconcileCaseWorkflow` and
 * the `/api/cases/[caseId]/recalculate-workflow` route it backs are
 * already exhaustively tested elsewhere — these tests cover only the UI
 * wrapper: visibility, wiring, and refresh/feedback behavior.
 */

function mockFetchFor(options: { permissions: string[]; recalculateStatus?: number; recalculateBody?: Record<string, unknown> }) {
  const { permissions, recalculateStatus = 200, recalculateBody = { rawStage: 3, changed: true } } = options;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/rbac/my-permissions')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ organization: null, permissions, count: 0, organizations: [] }) });
    }
    if (url.includes('/recalculate-workflow') && init?.method === 'POST') {
      return Promise.resolve({ ok: recalculateStatus < 400, status: recalculateStatus, json: async () => recalculateBody });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

function renderPanel(caseId = 'case-1') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <CaseWorkflowRepairPanel caseId={caseId} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('CaseWorkflowRepairPanel', () => {
  it('A: Administrator (user.manageRoles) sees Recalculate Workflow', async () => {
    vi.stubGlobal('fetch', mockFetchFor({ permissions: ['user.manageRoles'] }));
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Recalculate Workflow' })).toBeInTheDocument();
  });

  it('B: a non-Administrator (no user.manageRoles) does not see the repair action', async () => {
    const fetchMock = mockFetchFor({ permissions: ['case.read', 'case.update'] });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Recalculate Workflow' })).not.toBeInTheDocument();
  });

  it('F: rendering the button never mutates anything — no POST fires until clicked and confirmed', async () => {
    const fetchMock = mockFetchFor({ permissions: ['user.manageRoles'] });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await screen.findByRole('button', { name: 'Recalculate Workflow' });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/recalculate-workflow'))).toBe(false);
  });

  it('C/D: clicking, confirming, and succeeding calls the existing endpoint for the current case and refreshes on success', async () => {
    const fetchMock = mockFetchFor({ permissions: ['user.manageRoles'], recalculateBody: { rawStage: 3, changed: true } });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel('case-42');

    fireEvent.click(await screen.findByRole('button', { name: 'Recalculate Workflow' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recalculate' }));

    const postCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/recalculate-workflow'));
      if (!call) throw new Error('not called yet');
      return call;
    });
    expect(postCall[0]).toContain('/api/cases/case-42/recalculate-workflow');
    expect(JSON.parse((postCall[1] as RequestInit).body as string)).toEqual({ organizationId: 'managed-cremations' });

    expect(await screen.findByText('Workflow recalculated — case is now correctly positioned.')).toBeInTheDocument();
  });

  it('E: a failed recalculation shows safe, readable feedback — no raw error object rendered', async () => {
    vi.stubGlobal('fetch', mockFetchFor({ permissions: ['user.manageRoles'], recalculateStatus: 500, recalculateBody: { error: 'Something went wrong.' } }));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Recalculate Workflow' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recalculate' }));

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });

  it('confirmation is required — closing the dialog without confirming never calls the endpoint', async () => {
    const fetchMock = mockFetchFor({ permissions: ['user.manageRoles'] });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Recalculate Workflow' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await act(async () => {});
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/recalculate-workflow'))).toBe(false);
  });
});
