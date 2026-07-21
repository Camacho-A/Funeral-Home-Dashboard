import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case } from '@/types/case';
import { casesService } from '@/services/casesService';
import { advanceToNextStage } from '@/domain/cases/transitions';
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
    mutationFn: async (cases: Case[]) => {
      await Promise.all(
        cases.map((c) => casesService.update(organization, c.id, advanceToNextStage(c))),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
      queryClient.invalidateQueries({ queryKey: ['case', organization.organizationId] });
    },
  });
}
