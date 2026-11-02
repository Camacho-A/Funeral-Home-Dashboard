import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompleteCase } from './useCompleteCase';
import { useCaseMutations } from './useCaseMutations';
import { OrganizationProvider } from './useOrganization';
import { casesService } from '@/services/casesService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { CASE_REVISION_CONFLICT_MESSAGE, CASE_REVISION_CONFLICT_REASON } from '@/domain/cases/caseRevisionConflict';
import type { Case } from '@/types/case';

/**
 * Service-specific completion (2026-10) — useCompleteCase joins the case
 * page's per-case edit queue, is pinned to the revision the page holds,
 * refreshes the case on success and surfaces a 409 as `conflict`.
 * Fictional data; the complete route is stubbed.
 */
vi.mock('@/services/casesService', () => ({
  casesService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const CASE_ID = caseFixtures[0].id;
const CASE_KEY = ['case', DEFAULT_ORGANIZATION_ID, CASE_ID];
const testCase = (overrides: Partial<Case> = {}): Case => ({ ...caseFixtures[0], ...overrides });
const fetchMock = vi.fn();
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

function renderHooks() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>{children}</OrganizationProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => ({ complete: useCompleteCase(CASE_ID), edits: useCaseMutations(CASE_ID) }), { wrapper });
  return { ...hook, queryClient };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('useCompleteCase', () => {
  it('waits behind an in-flight case edit, then sends the revision that edit produced', async () => {
    const { result, queryClient } = renderHooks();
    queryClient.setQueryData(CASE_KEY, testCase({ revision: 3 }));
    let finishEdit: (value: Case) => void = () => {};
    vi.mocked(casesService.update).mockImplementation(() => new Promise<Case>((resolve) => (finishEdit = resolve)));
    fetchMock.mockResolvedValue(ok({ case: testCase({ revision: 5 }), completion: { mode: 'manual', archived: false } }));

    act(() => result.current.edits.updateCaseInfo({ placeOfDeath: 'FICTIONAL HOSPICE' }));
    act(() => result.current.complete.complete('Fictional reason'));
    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => finishEdit(testCase({ revision: 4 })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ reason: 'Fictional reason', expectedRevision: 4 });
    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_KEY)?.revision).toBe(5));
  });

  it('a 409 revision conflict becomes `conflict`, carrying the latest case; not a panel error', async () => {
    const { result, queryClient } = renderHooks();
    queryClient.setQueryData(CASE_KEY, testCase({ revision: 3 }));
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: testCase({ revision: 7 }) }),
    } as Response);
    act(() => result.current.complete.complete('Fictional reason'));
    await waitFor(() => expect(result.current.complete.conflict).not.toBeNull());
    expect(result.current.complete.conflict?.current?.revision).toBe(7);
    expect(result.current.complete.error).toBeNull();
  });

  it('any other refusal is an error with the server’s message', async () => {
    const { result, queryClient } = renderHooks();
    queryClient.setQueryData(CASE_KEY, testCase({ revision: 3 }));
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Not authorized.' }) } as Response);
    act(() => result.current.complete.complete('Fictional reason'));
    await waitFor(() => expect(result.current.complete.error?.message).toBe('Not authorized.'));
    expect(result.current.complete.conflict).toBeNull();
  });
});
