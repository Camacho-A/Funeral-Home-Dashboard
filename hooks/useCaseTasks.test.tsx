import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCaseTasks } from './useCaseTasks';
import { OrganizationProvider } from './useOrganization';
import { tasksService } from '@/services/tasksService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { CaseTask } from '@/types/task';

/**
 * Phase 17 (Case Detail Experience). This is the project's first
 * hook-level test — every prior phase tested mutation behavior indirectly
 * through a rendered component (e.g. NewCaseModal.test.tsx). The optimistic
 * toggle here has no visible DOM to assert on by itself (that lives in
 * CaseTasksCard, which just renders whatever `isDone` it's given), so the
 * thing worth proving — the query cache updates *before* the network call
 * resolves, and rolls back on failure — is a cache-level fact, not a
 * component-level one.
 */
vi.mock('@/services/tasksService', () => ({
  tasksService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

const CASE_ID = 'case-1';
const TASK: CaseTask = {
  id: 'task-1',
  organizationId: DEFAULT_ORGANIZATION_ID,
  text: 'Call the crematory',
  assigneeStaffId: 'staff-dana',
  isDone: false,
  caseId: CASE_ID,
  createdAt: '2026-07-23T00:00:00.000Z',
};

function renderWithClient() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['tasks', DEFAULT_ORGANIZATION_ID, { caseId: CASE_ID }], [TASK]);

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>{children}</OrganizationProvider>
    </QueryClientProvider>
  );

  const rendered = renderHook(() => useCaseTasks(CASE_ID), { wrapper });
  return { ...rendered, queryClient };
}

beforeEach(() => {
  vi.mocked(tasksService.list).mockResolvedValue([TASK]);
});

describe('useCaseTasks — optimistic task completion (Phase 17)', () => {
  it('flips isDone in the cache immediately, before the update request resolves', async () => {
    let resolveUpdate!: (task: CaseTask) => void;
    vi.mocked(tasksService.update).mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const { result, queryClient } = renderWithClient();
    await waitFor(() => expect(result.current.data).toEqual([TASK]));

    act(() => {
      result.current.toggleTask({ taskId: TASK.id, isDone: true });
    });

    // Still pending — no response has arrived yet — but the cache already
    // reflects the toggle optimistically (onMutate runs microtasks-ahead of
    // the still-unresolved network call).
    await waitFor(() => {
      const cached = queryClient.getQueryData<CaseTask[]>(['tasks', DEFAULT_ORGANIZATION_ID, { caseId: CASE_ID }]);
      expect(cached?.[0].isDone).toBe(true);
    });

    resolveUpdate({ ...TASK, isDone: true });
    await waitFor(() => expect(vi.mocked(tasksService.update)).toHaveBeenCalled());
  });

  it('rolls back to the previous value if the update request fails', async () => {
    vi.mocked(tasksService.update).mockRejectedValue(new Error('network error'));

    const { result, queryClient } = renderWithClient();
    await waitFor(() => expect(result.current.data).toEqual([TASK]));

    act(() => {
      result.current.toggleTask({ taskId: TASK.id, isDone: true });
    });

    // The reject happens fast enough in this test that asserting the
    // transient optimistic state would be a race; what actually matters —
    // and what a real network failure needs — is that it settles back to
    // the pre-toggle value rather than sticking on the failed optimistic one.
    await waitFor(() => expect(tasksService.update).toHaveBeenCalled());
    await waitFor(() => {
      const rolledBack = queryClient.getQueryData<CaseTask[]>([
        'tasks',
        DEFAULT_ORGANIZATION_ID,
        { caseId: CASE_ID },
      ]);
      expect(rolledBack?.[0].isDone).toBe(false);
    });
  });

  it('still calls tasksService.update with the real organizationId — authorization is unchanged', async () => {
    vi.mocked(tasksService.update).mockResolvedValue({ ...TASK, isDone: true });
    const { result } = renderWithClient();
    await waitFor(() => expect(result.current.data).toEqual([TASK]));

    act(() => {
      result.current.toggleTask({ taskId: TASK.id, isDone: true });
    });

    await waitFor(() =>
      expect(tasksService.update).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID }),
        TASK.id,
        { isDone: true },
        'mock',
      ),
    );
  });
});
