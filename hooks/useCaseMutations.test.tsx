import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCaseMutations } from './useCaseMutations';
import { OrganizationProvider } from './useOrganization';
import { casesService } from '@/services/casesService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { checklistItemKey } from '@/domain/workflow/checklistItemKey';
import { findStageByRawStage } from '@/domain/workflow/resolveStages';
import type { Case } from '@/types/case';

// toggleChecklistItem now writes a "{displayStage}:{index}" composite key
// (domain/workflow/checklistItemKey.ts) rather than a bare index — computed
// here from the real fixture's own workflowSnapshot/rawStage, the same way
// the hook itself does, rather than hardcoding a display stage number.
const FIXTURE_DISPLAY_STAGE = findStageByRawStage(caseFixtures[0].workflowSnapshot!, caseFixtures[0].rawStage)!.displayStage;
const KEY0 = checklistItemKey(FIXTURE_DISPLAY_STAGE, 0);
const KEY1 = checklistItemKey(FIXTURE_DISPLAY_STAGE, 1);

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

/**
 * Structured Certifier data (2026-09, ADR-041) — setCertifierName/Phone/
 * LicenseNumber/Fax. Unlike Weight/Time of Death, the intake template
 * (even in v5) deliberately gives none of these four fields a
 * checklistItemIndex — so buildStructuredIntakeFieldPatch always resolves
 * `index === null` for them, regardless of which workflowSnapshot version
 * the case carries. These tests prove that's exactly what happens (a
 * plain `{ certifierX: value }` patch, never a fieldValues write), through
 * the same real update path every other Case edit uses.
 */
describe('useCaseMutations#setCertifierName/Phone/LicenseNumber/Fax — no fieldValues sync, by design', () => {
  it('30. setCertifierName calls casesService.update with a certifierName-only patch (no fieldValues key)', async () => {
    const { result } = renderWithClient();
    const case_ = testCase();

    act(() => {
      result.current.setCertifierName(case_, 'DR. JANE FOSTER');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, calledCaseId, patch, mode] = vi.mocked(casesService.update).mock.calls[0];
    expect(calledCaseId).toBe(CASE_ID);
    expect(mode).toBe('mock');
    expect(patch).toEqual({ certifierName: 'DR. JANE FOSTER' });
  });

  it('31. setCertifierPhone calls casesService.update with a certifierPhone-only patch', async () => {
    const { result } = renderWithClient();
    const case_ = testCase();

    act(() => {
      result.current.setCertifierPhone(case_, '555-0199');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch).toEqual({ certifierPhone: '555-0199' });
  });

  it('32. setCertifierLicenseNumber calls casesService.update with a certifierLicenseNumber-only patch', async () => {
    const { result } = renderWithClient();
    const case_ = testCase();

    act(() => {
      result.current.setCertifierLicenseNumber(case_, 'MD-4471');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch).toEqual({ certifierLicenseNumber: 'MD-4471' });
  });

  it('33. setCertifierFax calls casesService.update with a certifierFax-only patch', async () => {
    const { result } = renderWithClient();
    const case_ = testCase();

    act(() => {
      result.current.setCertifierFax(case_, '555-0188');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch).toEqual({ certifierFax: '555-0188' });
  });

  it('34. accepts null (clearing the field back to unset) rather than only a string', async () => {
    const { result } = renderWithClient();
    const case_ = testCase();

    act(() => {
      result.current.setCertifierFax(case_, null);
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch).toEqual({ certifierFax: null });
  });

  it('35. never writes fieldValues even when the case has other fieldValues entries already set', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ fieldValues: { 0: 'JANE DOE', 3: '210 lb' } });

    act(() => {
      result.current.setCertifierName(case_, 'DR. JANE FOSTER');
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(patch.fieldValues).toBeUndefined();
    expect(Object.keys(patch).sort()).toEqual(['certifierName']);
  });
});

/**
 * Task #21 (2026-09, checklist response delay). Root cause: toggleChecklistItem's
 * shared `updateCase` mutation had no onMutate at all — the checklist
 * Checkbox's visual state is derived purely from the React Query cache
 * (see ChecklistCard.tsx), so it only flipped once the *entire* round trip
 * had resolved. These tests use a manually-controlled ("deferred") promise
 * for casesService.update, rather than an auto-resolving mock, so they can
 * assert the cache already reflects the new checked state *while the
 * server call is still pending* — the exact, rigorous proof that the
 * checkbox no longer waits for the server.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CASE_QUERY_KEY = ['case', DEFAULT_ORGANIZATION_ID, CASE_ID];

describe('useCaseMutations#toggleChecklistItem — optimistic update (Task #21, 2026-09)', () => {
  // Reuses the module-level KEY0/KEY1 (derived from the real fixture's own
  // displayStage above) rather than a second, hand-typed copy.
  const KEY_0 = KEY0;
  const KEY_1 = KEY1;

  it('1. checking an unchecked item updates the cached checked state immediately, before the server responds', async () => {
    const { result, queryClient } = renderWithClient();
    const case_ = testCase({ checklistState: { [KEY_0]: false } });
    queryClient.setQueryData(CASE_QUERY_KEY, case_);
    const { promise, resolve } = deferred<Case>();
    vi.mocked(casesService.update).mockReturnValue(promise);

    act(() => {
      result.current.toggleChecklistItem(case_, 0, true);
    });

    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(true));
    // The server call is still pending — the cache update above happened
    // independently of, and before, any server response.
    expect(casesService.update).toHaveBeenCalledTimes(1);

    resolve(testCase({ checklistState: { [KEY_0]: true } }));
    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(true));
  });

  it('2. unchecking a checked item updates the cached checked state immediately, before the server responds', async () => {
    const { result, queryClient } = renderWithClient();
    const case_ = testCase({ checklistState: { [KEY_0]: true } });
    queryClient.setQueryData(CASE_QUERY_KEY, case_);
    const { promise, resolve } = deferred<Case>();
    vi.mocked(casesService.update).mockReturnValue(promise);

    act(() => {
      result.current.toggleChecklistItem(case_, 0, false);
    });

    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(false));
    expect(casesService.update).toHaveBeenCalledTimes(1);
    resolve(testCase({ checklistState: { [KEY_0]: false } }));
  });

  it('3. the persistence request still occurs with the correct checklistState patch', async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ checklistState: { [KEY_0]: false, [KEY_1]: true } });

    act(() => {
      result.current.toggleChecklistItem(case_, 0, true);
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, calledCaseId, patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(calledCaseId).toBe(CASE_ID);
    expect(patch.checklistState).toEqual({ [KEY_0]: true, [KEY_1]: true });
  });

  it('4. a server success preserves the optimistic state (and settles the cache on the authoritative response)', async () => {
    const { result, queryClient } = renderWithClient();
    const case_ = testCase({ checklistState: { [KEY_0]: false } });
    queryClient.setQueryData(CASE_QUERY_KEY, case_);
    const serverCase = testCase({ checklistState: { [KEY_0]: true }, id: 'server-confirmed' });
    vi.mocked(casesService.update).mockResolvedValue(serverCase);

    act(() => {
      result.current.toggleChecklistItem(case_, 0, true);
    });

    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)).toEqual(serverCase));
  });

  it('5. a server failure rolls the item back to its previous state', async () => {
    const { result, queryClient } = renderWithClient();
    const case_ = testCase({ checklistState: { [KEY_0]: false } });
    queryClient.setQueryData(CASE_QUERY_KEY, case_);
    const { promise, reject } = deferred<Case>();
    vi.mocked(casesService.update).mockReturnValue(promise);

    act(() => {
      result.current.toggleChecklistItem(case_, 0, true);
    });
    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(true));

    reject(new Error('Wix Data update failed.'));

    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(false));
  });

  it('11. rapid check -> uncheck: an older (now-superseded) success response never overwrites the newer toggle', async () => {
    const { result, queryClient } = renderWithClient();
    const case_ = testCase({ checklistState: { [KEY_0]: false } });
    queryClient.setQueryData(CASE_QUERY_KEY, case_);
    const first = deferred<Case>();
    const second = deferred<Case>();
    vi.mocked(casesService.update).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    act(() => {
      result.current.toggleChecklistItem(case_, 0, true);
    });
    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(true));

    act(() => {
      result.current.toggleChecklistItem(testCase({ checklistState: { [KEY_0]: true } }), 0, false);
    });
    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(false));

    // The FIRST (now-stale) request resolves last, with data reflecting the
    // OLDER, now-superseded toggle — it must not clobber the newer one.
    first.resolve(testCase({ checklistState: { [KEY_0]: true } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(false);

    // The SECOND (latest) request then resolves, settling the cache
    // authoritatively on the user's actual last action.
    second.resolve(testCase({ checklistState: { [KEY_0]: false } }));
    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)).toEqual(testCase({ checklistState: { [KEY_0]: false } })));
  });

  it('12. toggling two different independent checklist items does not corrupt either item\'s state', async () => {
    const { result, queryClient } = renderWithClient();
    const case_ = testCase({ checklistState: { [KEY_0]: false, [KEY_1]: false } });
    queryClient.setQueryData(CASE_QUERY_KEY, case_);
    vi.mocked(casesService.update).mockImplementation((_ctx, _id, patch) =>
      Promise.resolve({ ...case_, checklistState: { ...case_.checklistState, ...(patch as Partial<Case>).checklistState } }),
    );

    act(() => {
      result.current.toggleChecklistItem(case_, 0, true);
    });
    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(true));
    expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_1]).toBe(false);
  });

  it("13. actual-employee attribution is untouched by this change — the patch carries only checklistState, never an actor/staff field", async () => {
    const { result } = renderWithClient();
    const case_ = testCase({ checklistState: { [KEY_0]: false } });

    act(() => {
      result.current.toggleChecklistItem(case_, 0, true);
    });

    await waitFor(() => expect(casesService.update).toHaveBeenCalled());
    const [, , patch] = vi.mocked(casesService.update).mock.calls[0];
    expect(Object.keys(patch)).toEqual(['checklistState']);
  });

  it('15. does not invalidate/refetch unrelated case data — the same targeted cache write as before, no page-wide refresh mechanism introduced', async () => {
    const { result, queryClient } = renderWithClient();
    const case_ = testCase({ checklistState: { [KEY_0]: false } });
    queryClient.setQueryData(CASE_QUERY_KEY, case_);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(casesService.update).mockResolvedValue(testCase({ checklistState: { [KEY_0]: true } }));

    act(() => {
      result.current.toggleChecklistItem(case_, 0, true);
    });

    await waitFor(() => expect(queryClient.getQueryData<Case>(CASE_QUERY_KEY)?.checklistState[KEY_0]).toBe(true));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    // Only the Cases *list* (unrelated to this one case's own query, and
    // already invalidated by every other Case edit before this change) —
    // never a broader/page-wide invalidation.
    expect(invalidatedKeys).toEqual([['cases', DEFAULT_ORGANIZATION_ID]]);
  });
});
