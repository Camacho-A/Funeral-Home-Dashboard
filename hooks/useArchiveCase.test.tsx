import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useArchiveCase } from './useArchiveCase';
import { OrganizationProvider } from './useOrganization';
import { casesService } from '@/services/casesService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { CaseRevisionConflictError } from '@/domain/cases/caseRevisionConflict';
import type { Case } from '@/types/case';

/** Archive / restore is pinned to the revision of the case the page holds
    (ported from Gus SOLIS). Fictional data; casesService is stubbed. */
vi.mock('@/services/casesService', () => ({
  casesService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const CASE_ID = caseFixtures[0].id;
const CASE_KEY = ['case', DEFAULT_ORGANIZATION_ID, CASE_ID];
const testCase = (overrides: Partial<Case> = {}): Case => ({ ...caseFixtures[0], ...overrides });

function render<T>(hook: () => T) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>{children}</OrganizationProvider>
    </QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), queryClient };
}

beforeEach(() => vi.clearAllMocks());

describe('useArchiveCase — pinned to a revision', () => {
  it('archives with the revision of the case the page holds', async () => {
    const { result, queryClient } = render(() => useArchiveCase());
    queryClient.setQueryData(CASE_KEY, testCase({ revision: 9 }));
    vi.mocked(casesService.update).mockResolvedValue(testCase({ revision: 10, isDeleted: true }));
    act(() => result.current.mutate({ caseId: CASE_ID, archived: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(casesService.update).mock.calls[0][2]).toEqual({ isDeleted: true });
    expect(vi.mocked(casesService.update).mock.calls[0][4]).toEqual({ expectedRevision: 9 });
  });

  it('a 409 shows the case as it is now (nothing archived)', async () => {
    const { result, queryClient } = render(() => useArchiveCase());
    queryClient.setQueryData(CASE_KEY, testCase({ revision: 1 }));
    const latest = testCase({ revision: 3, placeOfDeath: 'SOMEONE ELSE' });
    vi.mocked(casesService.update).mockRejectedValue(new CaseRevisionConflictError(latest));
    vi.mocked(casesService.get).mockResolvedValue(latest);
    act(() => result.current.mutate({ caseId: CASE_ID, archived: true }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<Case>(CASE_KEY)?.revision).toBe(3);
  });
});
