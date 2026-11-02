import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MarkCaseCompletedSection } from './MarkCaseCompletedSection';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import {
  completionItemOptions,
  finalItemsCompletionPolicy,
  remainsReturnCompletionPolicy,
  setManualCompletion,
} from '@/domain/workflow/completionPolicy';
import { burialStages, burialTemplate, burialVersion, caseOn, direct, directV } from '@/domain/workflow/crossServiceRegression.fixtures';
import { CASE_REVISION_CONFLICT_MESSAGE, CASE_REVISION_CONFLICT_REASON } from '@/domain/cases/caseRevisionConflict';
import type { Case } from '@/types/case';
import type { WorkflowCompletionPolicy } from '@/types/workflowTemplate';

/**
 * Service-specific completion (2026-10) — the Case Detail "Mark completed"
 * action. Fictional cases and workflow steps only; the complete route is
 * stubbed (no network).
 */

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

const CASE_ID = 'bu-mark';
const CASE_KEY = ['case', DEFAULT_ORGANIZATION_ID, CASE_ID];

const committal = () => completionItemOptions(burialStages()).find((o) => o.ref.label === 'Fictional committal confirmed')!.ref;
const burialPolicy = (): WorkflowCompletionPolicy =>
  setManualCompletion(finalItemsCompletionPolicy({ requiredFinalItems: [committal()] }), { allowed: true });

function burialCase(policy: WorkflowCompletionPolicy = burialPolicy(), overrides: Partial<Case> = {}): Case {
  const version = { ...burialVersion(1, burialStages()), completionPolicy: policy };
  return { ...caseOn(burialTemplate([version]), version, CASE_ID, 5), revision: 4, ...overrides };
}

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

function renderSection(case_: Case) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(CASE_KEY, case_);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <MarkCaseCompletedSection caseId={CASE_ID} case_={case_} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  mockPermissions(['case.read', 'case.update', 'case.delete']);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function openPanel() {
  fireEvent.click(await screen.findByRole('button', { name: 'Mark completed' }));
  return screen.getByRole('region', { name: 'Mark case completed' });
}

describe('MarkCaseCompletedSection — visibility', () => {
  it('shows "Mark completed" for a burial whose policy allows it, to a viewer with the policy’s permission', async () => {
    renderSection(burialCase());
    expect(await screen.findByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
  });

  it('shows nothing without the policy’s permission (default case.delete)', async () => {
    mockPermissions(['case.read', 'case.update']);
    const { container } = renderSection(burialCase());
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing for Direct Cremation (policy does not allow manual completion)', async () => {
    const { container } = renderSection({ ...caseOn(direct, directV, CASE_ID, 7), revision: 1 });
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing for a Manors / legacy case (no policy on its snapshot)', async () => {
    const manors = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!;
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
          <MarkCaseCompletedSection caseId={manors.id} case_={manors} />
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing once the case is already complete', async () => {
    const { container } = renderSection(burialCase(burialPolicy(), { checklistState: { '4:0': true } }));
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('MarkCaseCompletedSection — confirmation panel', () => {
  it('shows what the policy requires and which requirements are unmet', async () => {
    renderSection(burialCase());
    const panel = await openPanel();
    expect(panel).toHaveTextContent('No cremated remains are returned');
    expect(panel).toHaveTextContent('Fictional committal confirmed — not yet met');
  });

  it('requires a reason: confirm stays disabled until one is given', async () => {
    renderSection(burialCase());
    await openPanel();
    const confirm = screen.getAllByRole('button', { name: 'Mark completed' }).at(-1)!;
    expect(confirm).toBeDisabled();
    const reason = screen.getByLabelText('Reason (required)');
    fireEvent.change(reason, { target: { value: '   ' } });
    fireEvent.blur(reason);
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Give a reason for completing this case by hand.');
    fireEvent.change(reason, { target: { value: 'Fictional committal confirmed by the cemetery.' } });
    expect(confirm).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is disabled, with the reason, when the policy requires the return of remains and it is not recorded', async () => {
    renderSection(burialCase(setManualCompletion(remainsReturnCompletionPolicy(), { allowed: true })));
    const panel = await openPanel();
    expect(panel).toHaveTextContent('never replaces the return of cremated remains');
    expect(panel).toHaveTextContent('The return of cremated remains must be recorded before this case can be completed.');
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Fictional reason' } });
    expect(screen.getAllByRole('button', { name: 'Mark completed' }).at(-1)).toBeDisabled();
  });

  it('Cancel closes the panel without calling the server', async () => {
    renderSection(burialCase());
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Mark case completed' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MarkCaseCompletedSection — submitting', () => {
  it('calls the complete route with the reason and the revision held, then refreshes the case', async () => {
    const completed = burialCase(burialPolicy(), { revision: 5, manualCompletion: { completedAt: '2026-10-15T10:00:00.000Z', completedBy: 'identity-1', reason: 'Fictional reason' } });
    fetchMock.mockResolvedValue(jsonResponse(200, { case: completed, completion: { mode: 'manual', archived: false } }));
    const { queryClient } = renderSection(burialCase());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await openPanel();
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: '  Fictional reason  ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark completed' }).at(-1)!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/cases/${CASE_ID}/complete`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ organizationId: DEFAULT_ORGANIZATION_ID, reason: 'Fictional reason', expectedRevision: 4 });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: CASE_KEY }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cases', DEFAULT_ORGANIZATION_ID] });
    expect(queryClient.getQueryData<Case>(CASE_KEY)?.revision).toBe(5);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Mark case completed' })).not.toBeInTheDocument());
  });

  it('shows a server refusal in the panel, with its details', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'Fictional refusal.', details: ['Outstanding: Fictional item'] }));
    renderSection(burialCase());
    await openPanel();
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Fictional reason' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark completed' }).at(-1)!);
    expect(await screen.findByText('Fictional refusal. Outstanding: Fictional item')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mark case completed' })).toBeInTheDocument();
  });

  it('a 409 revision conflict shows the case edit conflict banner; Refresh loads the latest case', async () => {
    const latest = burialCase(burialPolicy(), { revision: 9 });
    fetchMock.mockResolvedValue(jsonResponse(409, { error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: latest }));
    const { queryClient } = renderSection(burialCase());
    await openPanel();
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Fictional reason' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark completed' }).at(-1)!);

    expect(await screen.findByText(`${CASE_REVISION_CONFLICT_MESSAGE} Your last change was not saved.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByText(/Your last change was not saved/)).not.toBeInTheDocument());
    expect(queryClient.getQueryData<Case>(CASE_KEY)?.revision).toBe(9);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Retry after a conflict asks again with the same reason, pinned to the latest revision', async () => {
    const latest = burialCase(burialPolicy(), { revision: 9 });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, { error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: latest }))
      .mockResolvedValueOnce(jsonResponse(200, { case: { ...latest, revision: 10 }, completion: { mode: 'manual', archived: false } }));
    renderSection(burialCase());
    await openPanel();
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Fictional reason' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark completed' }).at(-1)!);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry my change' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ organizationId: DEFAULT_ORGANIZATION_ID, reason: 'Fictional reason', expectedRevision: 9 });
  });
});
