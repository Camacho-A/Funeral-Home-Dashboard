import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case, CaseUpdate, VaPublishChoice, VaNotificationResponsibility } from '@/types/case';
import { casesService } from '@/services/casesService';
import { findChecklistIndexForCaseField } from '@/domain/workflow/resolveIntake';
import { checklistItemKey } from '@/domain/workflow/checklistItemKey';
import { caseRevision } from '@/lib/wixCaseMapper';
import { captureCaseMapBaseValues, type CaseMapBaseValues } from '@/domain/cases/caseMergeBase';
import { isCaseRevisionConflictError } from '@/domain/cases/caseRevisionConflict';
import { findStageByRawStage } from '@/domain/workflow/resolveStages';
import { useOrganization } from './useOrganization';
import { myPermissionsKey } from './useRbac';

/**
 * The Case Detail mutations the Frontend Engineering Plan's Hooks section
 * anticipated for Phase 6 (owner reassignment, checklist toggles, veteran
 * flags, ...) — distinct from useAdvanceCaseStage (Phase 5, the Dashboard's
 * bulk-advance action). Every function computes a small patch and calls
 * casesService.update through one shared mutation; callers pass the current
 * `Case` only where a patch needs to spread an existing map
 * (checklistState/fieldValues/vaStepsState) rather than replace it outright.
 */

/**
 * Builds the combined `{ [caseField]: value, fieldValues }` patch shared by
 * every structured-Case-field-that's-also-a-field-backed-checklist-item
 * mutator (setWeight, setTimeOfDeath, ...) — see setWeight's own comment
 * for why both must be written in the same patch. A plain function
 * (rather than a `this`-using object method) so it stays a safe, ordinary
 * call regardless of how a caller invokes the returned mutations object.
 */
function buildStructuredIntakeFieldPatch<K extends keyof CaseUpdate & string>(
  case_: Case,
  caseField: K,
  value: string | null,
): CaseUpdate {
  const patch: CaseUpdate = { [caseField]: value } as CaseUpdate;
  const index = case_.workflowSnapshot ? findChecklistIndexForCaseField(case_.workflowSnapshot.intake, caseField) : null;
  if (index !== null) {
    // Weight/Time of Death (the only callers with a real checklistItemIndex
    // today) always pass a non-null string — the `?? ''` only matters for a
    // hypothetical future nullable field-backed item, never for the
    // Certifier fields below (which deliberately have no checklistItemIndex
    // at all, so this branch never runs for them regardless of value).
    // Only the key being changed (case concurrency, 2026-10): the server
    // merges it onto the case as it is now.
    patch.fieldValues = { [index]: value ?? '' };
  }
  return patch;
}

/** A save of checklist ticks and nothing else. */
function isChecklistOnlyPatch(patch: CaseUpdate): patch is CaseUpdate & { checklistState: Record<string, boolean> } {
  const keys = Object.keys(patch);
  return keys.length === 1 && keys[0] === 'checklistState' && Boolean(patch.checklistState);
}

export function useCaseMutations(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  /**
   * Task #21 (2026-09, checklist response delay). Root cause: this shared
   * mutation had no onMutate at all — the checklist Checkbox's `checked`
   * prop is derived purely from the server-cached Case (see
   * ChecklistCard.tsx/useCaseViewModel), so it only visually flipped once
   * the *entire* round trip (Wix fetch existing → merge → persist → best-
   * effort Activity write → response → setQueryData) had completed. No
   * reconciliation/workflow-advance step was involved in that latency —
   * reconcileCaseWorkflow is never called by this PATCH route at all (only
   * by the Jotform-linking/payment-workflow paths) — it was purely "the UI
   * waits for the server" with zero local optimistic state.
   *
   * Scoped narrowly to `checklistState` patches only (the reported
   * interaction) — every other call below (setFieldValue, updateCaseInfo,
   * owner reassignment, VA steps, certifier saves, ...) is untouched and
   * keeps waiting for the real response exactly as before; this is not a
   * general "make all Case editing optimistic" change.
   *
   * `latestChecklistMutationId` is a monotonic "latest wins" guard against
   * rapid check→uncheck racing: each checklist-patch mutation captures its
   * own id at onMutate time; onError/onSuccess only touch the cache if
   * their id is still the most recent one issued. A stale (superseded)
   * response is a no-op for the cache — it never overwrites whatever a
   * newer toggle already established, and the newer toggle's own
   * eventual onSuccess/onError is what settles the cache authoritatively.
   */
  const latestChecklistMutationId = useRef(0);

  /**
   * Case concurrency (2026-10, docs/CASE_CONCURRENCY.md). Every save carries
   * the revision it was made against; the server refuses (409) a save the
   * case has moved past, so one person's stale page can no longer overwrite
   * another's work.
   *
   *  - Edits to one case run one at a time (`scope`), so each is sent with
   *    the revision the previous save produced — rapid edits never conflict
   *    with each other. `knownRevision` also remembers the newest revision
   *    seen, in case a latest-wins guard skipped a cache write.
   *  - Map edits (a checklist tick, one field value, one VA step) send only
   *    the changed key plus the value it had when clicked (`baseValues`), so
   *    an edit to an item nobody else touched still lands after someone
   *    else's unrelated save.
   *  - A refusal is surfaced as `conflict`; staff choose Refresh (load the
   *    current case) or Retry (re-apply their change to it).
   */
  const queryKey = ['case', organization.organizationId, caseId] as const;
  const knownRevision = useRef(0);
  const [conflict, setConflict] = useState<{ patch: CaseUpdate; current: Case | null } | null>(null);

  type CaseEdit = { patch: CaseUpdate; baseValues?: CaseMapBaseValues };

  /**
   * Checklist save latency (2026-10). Edits to a case run one at a time, so
   * ticking four items quickly used to send four saves back to back, each
   * waiting for the one before — and the case only moved to the next step
   * when the last finished. Now, while a checklist save is in flight, more
   * ticks are shown at once and collected here, then sent together as ONE
   * save the moment it returns. A tick undone before it is sent is dropped.
   */
  const checklistSaveInFlight = useRef(false);
  const queuedChecklist = useRef<{ values: Record<string, boolean>; base: Record<string, unknown> } | null>(null);

  /** Queued ticks drawn over a case from the server, so they never flicker off. */
  function withQueuedTicks(case_: Case): Case {
    const queued = queuedChecklist.current;
    return queued ? { ...case_, checklistState: { ...case_.checklistState, ...queued.values } } : case_;
  }

  function flushQueuedChecklist() {
    const queued = queuedChecklist.current;
    queuedChecklist.current = null;
    if (!queued) return;
    // An item never ticked (no stored value) reads as unticked.
    const keys = Object.keys(queued.values).filter((key) => queued.values[key] !== (queued.base[key] ?? false));
    if (keys.length === 0) return;
    const checklistState = Object.fromEntries(keys.map((key) => [key, queued.values[key]]));
    const base = Object.fromEntries(keys.map((key) => [key, queued.base[key] ?? null]));
    checklistSaveInFlight.current = true;
    updateCase.mutate({ patch: { checklistState }, baseValues: { checklistState: base } });
  }

  const updateCase = useMutation({
    scope: { id: `case-edit:${organization.organizationId}:${caseId}` },
    mutationFn: ({ patch, baseValues }: CaseEdit) => {
      const cached = queryClient.getQueryData<Case>(queryKey);
      const expectedRevision = Math.max(cached ? caseRevision(cached) : 0, knownRevision.current);
      // Mock mode only: the browser applies the administrator-only rule for
      // Workflow 3's "sent to crematory" items itself (with real data the
      // server decides). Read from the permissions the page already loaded.
      const permissions = queryClient.getQueryData<{ permissions?: string[] }>(myPermissionsKey(organization.organizationId))?.permissions ?? [];
      return casesService.update(organization, caseId, patch, organization.dataAdapterMode, {
        expectedRevision,
        baseValues,
        isAdministrator: permissions.includes('organization.manage'),
      });
    },
    onMutate: async ({ patch }) => {
      if (!('checklistState' in patch) || !patch.checklistState) return undefined;
      const mutationId = ++latestChecklistMutationId.current;
      await queryClient.cancelQueries({ queryKey });
      const previousCase = queryClient.getQueryData<Case>(queryKey);
      if (previousCase) {
        queryClient.setQueryData<Case>(queryKey, {
          ...previousCase,
          checklistState: { ...previousCase.checklistState, ...patch.checklistState },
        });
      }
      return { previousCase, mutationId, queryKey };
    },
    onError: (error, { patch }, context) => {
      if (isCaseRevisionConflictError(error)) {
        setConflict({ patch, current: error.current });
      }
      if (!context?.previousCase) return;
      // A later checklist toggle has already superseded this one — its own
      // onSuccess/onError will settle the cache; rolling back here would
      // incorrectly undo the newer action.
      if (context.mutationId !== latestChecklistMutationId.current) return;
      queryClient.setQueryData(context.queryKey, withQueuedTicks(context.previousCase));
    },
    onSuccess: (updated, _variables, context) => {
      knownRevision.current = Math.max(knownRevision.current, caseRevision(updated));
      // Same staleness guard for the success path: a superseded request's
      // server-confirmed data must not clobber a newer toggle's own
      // optimistic (or already-settled) state.
      if (context && context.mutationId !== latestChecklistMutationId.current) return;
      queryClient.setQueryData(queryKey, withQueuedTicks(updated));
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
    },
    onSettled: (_data, _error, { patch }) => {
      if (!isChecklistOnlyPatch(patch)) return;
      checklistSaveInFlight.current = false;
      flushQueuedChecklist();
    },
  });

  /** Base values are read at click time, before any optimistic update. */
  function save(patch: CaseUpdate) {
    const cached = queryClient.getQueryData<Case>(queryKey);
    const baseValues = captureCaseMapBaseValues(cached, patch);
    if (isChecklistOnlyPatch(patch) && checklistSaveInFlight.current && cached && baseValues?.checklistState) {
      const queued = queuedChecklist.current ?? { values: {}, base: {} };
      for (const [key, value] of Object.entries(patch.checklistState)) {
        // The value the item had before the FIRST queued tick is its base.
        if (!(key in queued.base)) queued.base[key] = baseValues.checklistState[key] ?? null;
        queued.values[key] = value;
      }
      queuedChecklist.current = queued;
      queryClient.setQueryData<Case>(queryKey, withQueuedTicks(cached));
      return;
    }
    if (isChecklistOnlyPatch(patch)) checklistSaveInFlight.current = true;
    updateCase.mutate({ patch, ...(baseValues ? { baseValues } : {}) });
  }

  return {
    isPending: updateCase.isPending,

    /** Set when a save was refused because the case had changed. */
    conflict,

    /** Show the case as it is now; the refused change is dropped. */
    refreshAfterConflict() {
      if (conflict?.current) {
        queryClient.setQueryData(queryKey, conflict.current);
        knownRevision.current = Math.max(knownRevision.current, caseRevision(conflict.current));
      }
      setConflict(null);
      queryClient.invalidateQueries({ queryKey });
    },

    /** Re-apply the refused change to the case as it is now — an explicit
        staff decision to keep their value over the newer one. */
    retryAfterConflict() {
      if (!conflict) return;
      const { patch, current } = conflict;
      if (current) {
        queryClient.setQueryData(queryKey, current);
        knownRevision.current = Math.max(knownRevision.current, caseRevision(current));
      }
      setConflict(null);
      save(patch);
    },

    /**
     * Keyed by the case's current *display* stage, not rawStage — First
     * Call (rawStage 0) and Payment (rawStage 1) share one displayStage
     * and one combined checklist (see domain/workflow/checklistItemKey.ts),
     * so a toggle made while the case is at either rawStage must write the
     * same composite key. Only ever wired to the editable, current-stage
     * checklist (ChecklistCard); a viewed/past stage renders read-only and
     * never calls this.
     */
    /** `onDisplayStage`: the stage the item belongs to when it is not the
        case's current one — an earlier stage being completed or corrected
        (2026-10). Recorded on that stage; the case's stage is unchanged. */
    toggleChecklistItem(case_: Case, index: number, newDone: boolean, onDisplayStage?: number | null) {
      const displayStage =
        onDisplayStage ??
        (case_.workflowSnapshot ? findStageByRawStage(case_.workflowSnapshot, case_.rawStage)?.displayStage ?? case_.rawStage : case_.rawStage);
      save({ checklistState: { [checklistItemKey(displayStage, index)]: newDone } });
    },

    setFieldValue(case_: Case, index: number, value: string) {
      save({ fieldValues: { [index]: value } });
    },

    reassignOwner(staffId: string | null) {
      save({ assignedStaffId: staffId });
    },

    /**
     * Phase 17 (Case Detail Experience): the single generic entry point for
     * CaseInformationCard's inline-editable fields (dates, location, next of
     * kin, payment status, ...). No new update logic — it's the exact same
     * updateCase mutation every other method here already uses, which
     * already branches on dataAdapterMode to hit the real Wix PATCH route;
     * this method just exists so the component doesn't need one
     * differently-named mutator per field.
     */
    updateCaseInfo(patch: CaseUpdate) {
      save(patch);
    },

    /**
     * Case field editing / field-backed checklist sync (2026-09). Weight,
     * and now Time of Death, are both structured Case properties (shown in
     * CaseInformationCard) that are *also* field-backed First Call &
     * Payment checklist items — editing only Case.<field> (the way
     * updateCaseInfo's other structured fields work) would leave that
     * checklist item permanently "incomplete", since resolveChecklist.ts's
     * isFieldDone reads fieldValues[index], never the structured Case
     * property directly. This writes both in the same patch, so the
     * checklist recognizes completion immediately without a second save —
     * and without ever touching checklistState or rawStage/currentStage
     * directly, which stay driven by the existing field-backed completion
     * logic exactly as they already are for every other field-backed item.
     *
     * The index is resolved from the case's own workflowSnapshot.intake
     * (findChecklistIndexForCaseField) rather than assumed — this is a
     * generic mechanism, not a per-field special case; it works the same
     * way for any structured Case field an intake template maps to a
     * checklist index (the Hospice/physician contact fits this same shape;
     * wiring it through the UI is a deliberately separate, later step, not
     * a limitation of this function).
     */
    setWeight(case_: Case, value: string) {
      save(buildStructuredIntakeFieldPatch(case_, 'weight', value));
    },

    setTimeOfDeath(case_: Case, value: string) {
      save(buildStructuredIntakeFieldPatch(case_, 'timeOfDeath', value));
    },

    /**
     * Structured Certifier data (2026-09, ADR-041). Unlike Weight/Time of
     * Death, the v5 intake template deliberately gives none of the four
     * certifier fields a checklistItemIndex — buildStructuredIntakeFieldPatch
     * still handles that correctly with zero changes (findChecklistIndexForCaseField
     * resolves null, so the returned patch is just `{ certifierX: value }`,
     * never touching fieldValues). The "Certifier Information" checklist
     * item's own completion comes from requiredCaseFields
     * (domain/workflow/resolveChecklist.ts), reading these structured
     * fields directly.
     */
    setCertifierName(case_: Case, value: string | null) {
      save(buildStructuredIntakeFieldPatch(case_, 'certifierName', value));
    },

    setCertifierPhone(case_: Case, value: string | null) {
      save(buildStructuredIntakeFieldPatch(case_, 'certifierPhone', value));
    },

    setCertifierLicenseNumber(case_: Case, value: string | null) {
      save(buildStructuredIntakeFieldPatch(case_, 'certifierLicenseNumber', value));
    },

    setCertifierFax(case_: Case, value: string | null) {
      save(buildStructuredIntakeFieldPatch(case_, 'certifierFax', value));
    },

    setVeteranFlag(newValue: boolean) {
      save({ isVeteran: newValue });
    },

    toggleVaStep(case_: Case, index: number, newDone: boolean) {
      save({ vaStepsState: { [index]: newDone } });
    },

    setVaPublishChoice(choice: VaPublishChoice) {
      save({ vaPublishChoice: choice });
    },

    /** VA responsibility correction (2026-09) — independent of
        setVeteranFlag; never implies/changes isVeteran. */
    setVaNotificationResponsibility(responsibility: VaNotificationResponsibility) {
      save({ vaNotificationResponsibility: responsibility });
    },
  };
}
