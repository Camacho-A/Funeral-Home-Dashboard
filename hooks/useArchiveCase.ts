import { useMutation, useQueryClient } from '@tanstack/react-query';
import { casesService } from '@/services/casesService';
import { useOrganization } from './useOrganization';

/**
 * Archived Cases (2026-10).
 *
 * Archiving is a SOFT flag and nothing more. `isDeleted` (stored as the
 * `cases` collection's own `isArchived`) is the single field that changes:
 * the case row, its case number, its checklist state, its documents, its
 * payments and its whole activity history all survive untouched, and
 * restoring is the same one-field write in reverse. Nothing here deletes
 * anything, and there is deliberately no hard-delete counterpart.
 *
 * It goes through the ordinary authorized case PATCH — the same
 * permission, validation and audit path as every other case edit — rather
 * than a bespoke endpoint, so organization isolation and
 * `case.update` gating apply with no new surface to get wrong. The route
 * emits its own `case.archived` / `case.restored` activity event.
 *
 * Invalidates the whole `['cases', organizationId]` subtree, which covers
 * both the active and archived list queries plus the case itself — so an
 * archived case leaves the working list and appears under Archived in one
 * round trip, with no stale row left behind in either view.
 */
export function useArchiveCase() {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ caseId, archived }: { caseId: string; archived: boolean }) =>
      casesService.update(organization, caseId, { isDeleted: archived }, organization.dataAdapterMode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
    },
  });
}
