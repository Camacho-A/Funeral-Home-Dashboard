import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCaseCounts } from './useCaseCounts';
import { OrganizationProvider } from './useOrganization';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Case } from '@/types/case';

const pushedIds: string[] = [];

function pushCase(id: string, overrides: Partial<Case> & { caseNumber: string; createdAt: string }) {
  const template = caseFixtures.find((c) => c.organizationId !== SECOND_MOCK_ORGANIZATION_ID && !c.isDeleted)!;
  caseFixtures.push({
    ...template,
    ...overrides,
    id,
    organizationId: SECOND_MOCK_ORGANIZATION_ID,
    isDeleted: overrides.isDeleted ?? false,
  });
  pushedIds.push(id);
}

afterEach(() => {
  while (pushedIds.length > 0) {
    const id = pushedIds.pop()!;
    const index = caseFixtures.findIndex((c) => c.id === id);
    if (index !== -1) caseFixtures.splice(index, 1);
  }
});

function renderWithClient(searchQuery: string) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={SECOND_MOCK_ORGANIZATION_ID}>{children}</OrganizationProvider>
    </QueryClientProvider>
  );
  return renderHook(() => useCaseCounts({ searchQuery }), { wrapper });
}

describe('useCaseCounts — tab counts (Case list scalability, Phase 3)', () => {
  it('reflects total + per-stage counts from the server-side counts architecture (Phase 2), not a loaded page', async () => {
    pushCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 0 });
    pushCase('b', { caseNumber: 'B2026-102', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
    pushCase('c', { caseNumber: 'B2026-103', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });

    const { result } = renderWithClient('');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.total).toBe(3);
    expect(result.current.data!.byStage['First Call & Payment']).toBe(1);
    expect(result.current.data!.byStage['Completed']).toBe(2);
  });

  it('is search-aware: counts narrow to the matching subset when a search query is supplied', async () => {
    pushCase('match', { caseNumber: 'B2026-201', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY', rawStage: 7 });
    pushCase('no-match', { caseNumber: 'B2026-202', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'SMITH FAMILY', rawStage: 7 });

    const { result } = renderWithClient('morales');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.total).toBe(1);
    expect(result.current.data!.byStage['Completed']).toBe(1);
  });
});
