import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case } from '@/types/case';
import { casesService } from '@/services/casesService';
import { advanceToNextStage } from '@/domain/cases/transitions';
import { caseRevision } from '@/lib/wixCaseMapper';
import { isCaseRevisionConflictError } from '@/domain/cases/caseRevisionConflict';
import { useOrganization } from './useOrganization';

/**
 * Backs the Dashboard's "Advance N to next stage" bulk action
 * (BulkActionBar). Not part of Phase 4's explicit hook list — that phase
 * deferred case mutations to Phase 6 since nothing needed them yet, but
 * Phase 5's bulk-advance button is a real mutation and can't be built
 * without one. Computes each case's patch via domain/cases/transitions.ts's
 * advanceToNextStage rather than reimplementing that rule here.
 *
 * Deliberately narrow (just this one action) rather than the fuller
 * useCaseMutations surface (owner reassignment, checklist toggles, veteran
 * flags, ...) described for Phase 6 — that's a separate, later concern with
 * its own real UI to design against.
 */
export function useAdvanceCaseStage() {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    /**
     * Case concurrency (2026-10). Two fixes:
     *  - The adapter mode was never passed, so in production (wix) this ran
     *    against the browser's in-memory mock fixtures and nothing was
     *    persisted or authorized server-side. It now goes through the real,
     *    authorized PATCH route.
     *  - Each advance is made against the revision of the row the list
     *    showed. `rawStage + 1` is computed from that row, so if the case
     *    has changed since (another advance, reconciliation), the save is
     *    refused rather than moving the case to a stage computed from stale
     *    data — never backwards, never double-counted.
     * Every selected case is attempted; refusals are reported together.
     */
    mutationFn: async (cases: Case[]) => {
      const results = await Promise.allSettled(
        cases.map((c) =>
          casesService.update(organization, c.id, advanceToNextStage(c), organization.dataAdapterMode, {
            expectedRevision: caseRevision(c),
          }),
        ),
      );
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failures.length === 0) return;
      const conflicts = failures.filter((f) => isCaseRevisionConflictError(f.reason)).length;
      const others = failures.length - conflicts;
      const parts = [
        conflicts > 0 ? `${conflicts} case${conflicts === 1 ? ' was' : 's were'} changed by someone else and not advanced` : '',
        others > 0 ? `${others} case${others === 1 ? '' : 's'} could not be advanced` : '',
      ].filter(Boolean);
      throw new Error(`${parts.join('; ')}. Refresh the list and try again.`);
    },
    onError: () => {
      // Whatever did advance is reflected; refusals show current data.
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
      queryClient.invalidateQueries({ queryKey: ['case', organization.organizationId] });
    },
  });
}
