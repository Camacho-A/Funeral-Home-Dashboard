import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case } from '@/types/case';
import { casesService } from '@/services/casesService';
import { caseRevision } from '@/lib/wixCaseMapper';
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
 * both the active and archived list queries — so an archived case leaves
 * the working list and appears under Archived in one round trip, with no
 * stale row left behind in either view.
 *
 * The open case ITSELF is a separate key, `['case', organizationId,
 * caseId]` (singular — see hooks/useCase.ts), which the list prefix does
 * not match. It must be invalidated explicitly or the detail page keeps
 * rendering the pre-change state: before archived cases could be opened
 * at all this was invisible, but now it reads as "I clicked Restore and
 * nothing happened."
 */
export function useArchiveCase() {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    // Case concurrency (2026-10): made against the revision of the case the
    // page shows — the open case's own cache entry, else a fresh read — so an
    // archive/restore can never be based on a case someone has since changed.
    mutationFn: async ({ caseId, archived }: { caseId: string; archived: boolean }) => {
      const cached = queryClient.getQueryData<Case>(['case', organization.organizationId, caseId]);
      const current = cached ?? (await casesService.get(organization, caseId, organization.dataAdapterMode));
      if (!current) throw new Error('This case could not be found.');
      return casesService.update(organization, caseId, { isDeleted: archived }, organization.dataAdapterMode, {
        expectedRevision: caseRevision(current),
      });
    },
    onSuccess: (_result, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
      queryClient.invalidateQueries({ queryKey: ['case', organization.organizationId, caseId] });
    },
  });
}
