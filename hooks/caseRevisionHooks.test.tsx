import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAdvanceCaseStage } from './useAdvanceCaseStage';
import { useArchiveCase } from './useArchiveCase';
import { OrganizationProvider } from './useOrganization';
import { casesService } from '@/services/casesService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { CaseRevisionConflictError } from '@/domain/cases/caseRevisionConflict';
import type { Case } from '@/types/case';

/**
 * Case concurrency (2026-10). The two case writers outside useCaseMutations
 * — the cases list's bulk "Advance" and Archive/Restore — must also save
 * against a revision, through the real (Wix) path in production.
 */
vi.mock('@/services/casesService', () => ({
  casesService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID} dataAdapterMode="wix">
          {children}
        </OrganizationProvider>
      </QueryClientProvider>
    );
  };
}

const row = (overrides: Partial<Case>): Case => ({ ...caseFixtures[0], ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAdvanceCaseStage', () => {
  it('saves through the production adapter (was silently mock-only) against each row\'s revision', async () => {
    vi.mocked(casesService.update).mockResolvedValue(row({}));
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useAdvanceCaseStage(), { wrapper: wrapperFor(queryClient) });

    act(() => result.current.mutate([row({ id: 'a', rawStage: 2, revision: 4 }), row({ id: 'b', rawStage: 5 })]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calls = vi.mocked(casesService.update).mock.calls;
    expect(calls.map((call) => call[3])).toEqual(['wix', 'wix']);
    expect(calls.map((call) => call[4]?.expectedRevision)).toEqual([4, 0]);
    expect(calls[0][2]).toEqual({ rawStage: 3, daysWaitingInStage: 0 });
  });

  it('attempts every case and reports the ones that had changed', async () => {
    vi.mocked(casesService.update)
      .mockResolvedValueOnce(row({}))
      .mockRejectedValueOnce(new CaseRevisionConflictError(null));
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useAdvanceCaseStage(), { wrapper: wrapperFor(queryClient) });

    act(() => result.current.mutate([row({ id: 'a' }), row({ id: 'b' })]));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(casesService.update).toHaveBeenCalledTimes(2);
    expect(result.current.error?.message).toMatch(/1 case was changed by someone else and not advanced/);
  });
});

describe('useArchiveCase', () => {
  it('archives against the open case\'s cached revision', async () => {
    vi.mocked(casesService.update).mockResolvedValue(row({}));
    const queryClient = new QueryClient();
    queryClient.setQueryData(['case', DEFAULT_ORGANIZATION_ID, 'case-x'], row({ id: 'case-x', revision: 9 }));
    const { result } = renderHook(() => useArchiveCase(), { wrapper: wrapperFor(queryClient) });

    act(() => result.current.mutate({ caseId: 'case-x', archived: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [, caseId, patch, mode, options] = vi.mocked(casesService.update).mock.calls[0];
    expect([caseId, patch, mode, options?.expectedRevision]).toEqual(['case-x', { isDeleted: true }, 'wix', 9]);
  });

  it('reads the case first when it is not cached, rather than saving blind', async () => {
    vi.mocked(casesService.get).mockResolvedValue(row({ id: 'case-y', revision: 3 }));
    vi.mocked(casesService.update).mockResolvedValue(row({}));
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useArchiveCase(), { wrapper: wrapperFor(queryClient) });

    act(() => result.current.mutate({ caseId: 'case-y', archived: false }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(casesService.get).toHaveBeenCalled();
    expect(vi.mocked(casesService.update).mock.calls[0][4]?.expectedRevision).toBe(3);
  });
});
