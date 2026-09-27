import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCaseMutations } from './useCaseMutations';
import { OrganizationProvider } from './useOrganization';
import { casesService } from '@/services/casesService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Case } from '@/types/case';

/**
 * Case field editing / field-backed checklist sync (2026-09). `setWeight`
 * is the first caller of findChecklistIndexForCaseField
 * (domain/workflow/resolveIntake.ts) — these tests exercise the mutation
 * through the *real* update path (mocking only casesService.update, the
 * network boundary, exactly like useCaseTasks.test.tsx's own precedent),
 * proving the computed patch is what the normal Case update architecture
 * actually receives — never a bespoke B2026-034-specific write.
 */
vi.mock('@/services/casesService', () => ({
  casesService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const CASE_ID = caseFixtures[0].id;

// The real Managed Cremations fixture's own workflowSnapshot.intake maps
// 'weight' to checklistItemIndex 3 — asserted directly (not assumed) in
// resolveIntake.test.ts's own fixture-mirroring test suite for
// buildIntakeFieldValues; reused here rather than hand-authoring a second
// full Case object, so this test exercises the actual production shape.
function testCase(overrides: Partial<Case> = {}): Case {
  return { ...caseFixtures[0], ...overrides };
}

function renderWithClient() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>{children}</OrganizationProvider>
    </QueryClientProvider>
  );
  const rendered = renderHook(() => useCaseMutations(CASE_ID), { wrapper });
  return { ...rendered, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(casesService.update).mockResolvedValue(testCase({ weight: '210 lb' }));
});

describe('useCaseMutations#setWeight — normal Case update architecture, no bespoke recovery path', () => {
  it('1/2. calls the real casesService.update (the same path every other Case edit uses) with Case.weight set', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ fieldValues: {} });

    act(() => {
      result.current.setWeight(case_, '210 lb');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, calledCaseId, patch, mode] = vi.mocked(casesService.update).mock.calls[0];
    expect(calledCaseId).toBe(CASE_ID);
    expect(mode).toBe('mock');
    expect(patch.weight).toBe('210 lb');
  });

  it('3. also sets fieldValues[3] — the standard cremation intake\'s checklistItemIndex for Weight', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ fieldValues: {} });

    act(() => {
      result.current.setWeight(case_, '210 lb');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch.fieldValues).toEqual({ 3: '210 lb' });
  });

  it('4. preserves every other existing fieldValues entry — never a bare {3: value} replacement', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ fieldValues: { 0: 'JANE DOE', 1: 'ST. MARY\'S HOSPITAL', 7: 'KAREN ELLISON — 555-0100' } });

    act(() => {
      result.current.setWeight(case_, '210 lb');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch.fieldValues).toEqual({
      0: 'JANE DOE',
      1: 'ST. MARY\'S HOSPITAL',
      7: 'KAREN ELLISON — 555-0100',
      3: '210 lb',
    });
  });

  it('6. never includes checklistState in the patch — completion is derived, not manually set', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ checklistState: { 8: true } });

    act(() => {
      result.current.setWeight(case_, '210 lb');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch.checklistState).toBeUndefined();
  });

  it('7. never includes rawStage in the patch — the workflow stage is never manually forced', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ rawStage: 0 });

    act(() => {
      result.current.setWeight(case_, '210 lb');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch.rawStage).toBeUndefined();
  });

  it('9. the patch never carries any other structured Case field (organizationId, decedentName, ...) — the server\'s own full-record merge, not this hook, is what preserves them', async () => {
    const { result } = renderWithClient();
    const case_ = testCase();

    act(() => {
      result.current.setWeight(case_, '210 lb');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(Object.keys(patch).sort()).toEqual(['fieldValues', 'weight']);
  });

  it('falls back to a weight-only patch (no fieldValues key at all) if the case has no workflowSnapshot', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ workflowSnapshot: null });

    act(() => {
      result.current.setWeight(case_, '210 lb');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch).toEqual({ weight: '210 lb' });
  });
});

/**
 * Time of Death (2026-09) — the second caller of buildStructuredIntakeFieldPatch
 * (the shared helper setWeight already established), proving the same
 * generic sync mechanism works unmodified for a different structured Case
 * field/checklist index (5, not hardcoded — resolved from the real
 * fixture's own workflowSnapshot.intake, per resolveIntake.test.ts's own
 * fixture-mirroring assertion for 'timeOfDeath').
 */
describe('useCaseMutations#setTimeOfDeath — reuses the Weight architecture, no new mechanism', () => {
  it('1/2. calls the real casesService.update with Case.timeOfDeath set', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ fieldValues: {} });

    act(() => {
      result.current.setTimeOfDeath(case_, '15:45');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, calledCaseId, patch, mode] = vi.mocked(casesService.update).mock.calls[0];
    expect(calledCaseId).toBe(CASE_ID);
    expect(mode).toBe('mock');
    expect(patch.timeOfDeath).toBe('15:45');
  });

  it('3/4. also sets fieldValues[5] (derived from the intake, not hardcoded) without disturbing other indices', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ fieldValues: { 0: 'JANE DOE', 3: '210 lb' } });

    act(() => {
      result.current.setTimeOfDeath(case_, '15:45');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch.fieldValues).toEqual({ 0: 'JANE DOE', 3: '210 lb', 5: '15:45' });
  });

  it('7. never includes checklistState in the patch — completion is derived, not manually set', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ checklistState: { 8: true } });

    act(() => {
      result.current.setTimeOfDeath(case_, '15:45');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch.checklistState).toBeUndefined();
  });

  it('8. never includes rawStage in the patch — the workflow stage is never manually forced', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ rawStage: 0 });

    act(() => {
      result.current.setTimeOfDeath(case_, '15:45');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch.rawStage).toBeUndefined();
  });

  it('the patch never carries any other structured Case field — the server\'s own full-record merge preserves them', async () => {
    const { result } = renderWithClient();
    const case_ = testCase();

    act(() => {
      result.current.setTimeOfDeath(case_, '15:45');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(Object.keys(patch).sort()).toEqual(['fieldValues', 'timeOfDeath']);
  });

  it('falls back to a timeOfDeath-only patch if the case has no workflowSnapshot', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ workflowSnapshot: null });

    act(() => {
      result.current.setTimeOfDeath(case_, '15:45');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch).toEqual({ timeOfDeath: '15:45' });
  });
});
