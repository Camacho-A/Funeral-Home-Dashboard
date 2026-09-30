import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLinkSubmissionToCase, useImportHistoricalSubmission, useApplyReconciliation, useCreateHistoricalCase } from './useExternalForms';
import * as externalFormsClient from '@/lib/externalFormsClient';

/**
 * Case progression fix (2026-09, Task #1). Root cause: linking/importing a
 * historical submission, or applying reconciled fields, can advance a
 * case's rawStage server-side (workflowReconciliationService#
 * reconcileCaseWorkflow) — but none of these three mutations invalidated
 * the `['case', organizationId, caseId]` query React Query's `useCase`
 * reads from, so an already-open Case Detail page kept rendering its
 * stale, pre-reconciliation stage/checklist even though the persisted
 * record had already advanced. These tests assert the invalidation
 * itself — the exact regression this checkpoint's fix targets.
 */
vi.mock('@/lib/externalFormsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/externalFormsClient')>('@/lib/externalFormsClient');
  return {
    ...actual,
    linkSubmissionToCase: vi.fn().mockResolvedValue(undefined),
    importHistoricalSubmission: vi.fn().mockResolvedValue({ alreadyImported: false }),
    applyReconciliation: vi.fn().mockResolvedValue(undefined),
    createHistoricalCase: vi.fn().mockResolvedValue({ alreadyImported: false, caseId: 'case-new-1', caseNumber: 'B2024-007' }),
  };
});

const ORGANIZATION_ID = 'managed-cremations';
const CASE_ID = 'case-under-test-1';

function renderWithClient() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLinkSubmissionToCase — invalidates the target case query, not only the unmatched-submissions list', () => {
  it('invalidates both unmatchedExternalFormSubmissions and case, [organizationId, caseId] on success', async () => {
    const { queryClient, wrapper } = renderWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useLinkSubmissionToCase(ORGANIZATION_ID), { wrapper });

    act(() => {
      result.current.mutate({ submissionId: 'sub-1', caseId: CASE_ID });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(externalFormsClient.linkSubmissionToCase).toHaveBeenCalledWith(ORGANIZATION_ID, 'sub-1', CASE_ID);
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['unmatchedExternalFormSubmissions', ORGANIZATION_ID]);
    expect(invalidatedKeys).toContainEqual(['case', ORGANIZATION_ID, CASE_ID]);
  });
});

describe('useImportHistoricalSubmission — invalidates the case query alongside the case-forms list', () => {
  it('invalidates both caseForms and case, [organizationId, caseId] on success', async () => {
    const { queryClient, wrapper } = renderWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useImportHistoricalSubmission(ORGANIZATION_ID, CASE_ID), { wrapper });

    act(() => {
      result.current.mutate({ formConfigId: 'config-1', externalSubmissionId: 'ext-sub-1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(externalFormsClient.importHistoricalSubmission).toHaveBeenCalledWith(ORGANIZATION_ID, CASE_ID, 'config-1', 'ext-sub-1');
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['caseForms', ORGANIZATION_ID, CASE_ID]);
    expect(invalidatedKeys).toContainEqual(['case', ORGANIZATION_ID, CASE_ID]);
  });
});

describe('useApplyReconciliation — invalidates the case query alongside the case-forms list', () => {
  it('invalidates both caseForms and case, [organizationId, caseId] on success', async () => {
    const { queryClient, wrapper } = renderWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useApplyReconciliation(ORGANIZATION_ID, CASE_ID), { wrapper });

    act(() => {
      result.current.mutate({ submissionId: 'sub-1', fieldsToApply: ['dateOfBirth'] });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(externalFormsClient.applyReconciliation).toHaveBeenCalledWith(ORGANIZATION_ID, 'sub-1', CASE_ID, ['dateOfBirth']);
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['caseForms', ORGANIZATION_ID, CASE_ID]);
    expect(invalidatedKeys).toContainEqual(['case', ORGANIZATION_ID, CASE_ID]);
  });
});

/**
 * Task #20 (2026-09, close import window after success). Root cause part
 * 1: useCreateHistoricalCase had no onSuccess at all — a genuinely new
 * case was created server-side, but the Cases list query (['cases',
 * organizationId], the same key useCreateCase/useCaseMutations/
 * useAdvanceCaseStage all invalidate) was never invalidated, so it
 * wouldn't appear in the existing Cases experience without a manual
 * browser refresh.
 */
describe('useCreateHistoricalCase — invalidates the Cases list on a genuinely new case, not on the duplicate-protection no-op', () => {
  it('invalidates [\'cases\', organizationId] when a new case was created (!alreadyImported)', async () => {
    vi.mocked(externalFormsClient.createHistoricalCase).mockResolvedValueOnce({
      alreadyImported: false,
      caseId: 'case-new-1',
      caseNumber: 'B2024-007',
    });
    const { queryClient, wrapper } = renderWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateHistoricalCase(ORGANIZATION_ID), { wrapper });

    act(() => {
      result.current.mutate({ formConfigId: 'config-1', externalSubmissionId: 'ext-sub-1', nextOfKinName: 'Karen Ellison', nextOfKinPhone: '555-0100' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['cases', ORGANIZATION_ID]);
  });

  it('does NOT invalidate the Cases list when the submission was already imported (no new case created)', async () => {
    vi.mocked(externalFormsClient.createHistoricalCase).mockResolvedValueOnce({
      alreadyImported: true,
      caseId: 'case-existing-1',
      caseNumber: null,
    });
    const { queryClient, wrapper } = renderWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateHistoricalCase(ORGANIZATION_ID), { wrapper });

    act(() => {
      result.current.mutate({ formConfigId: 'config-1', externalSubmissionId: 'ext-sub-1', nextOfKinName: 'Karen Ellison', nextOfKinPhone: '555-0100' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).not.toContainEqual(['cases', ORGANIZATION_ID]);
  });
});
