import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NewCaseLogEntryClientInput } from '@/types/caseLogEntry';
import { fetchCaseLog, createCaseLogEntry } from '@/lib/caseLogClient';
import { useOrganization } from './useOrganization';

/**
 * Raw-field-name leak fix follow-up (2026-10) — now fetches/mutates via
 * `lib/caseLogClient.ts` (real `/api/cases/[caseId]/log` round trip)
 * instead of calling `services/caseLogService.ts` directly; that service
 * is server-only now (imports `lib/wixDataApi.ts`). Same public shape as
 * before — `{ ...query, addEntry: addEntry.mutate }` — so
 * `app/(portal)/cases/[caseId]/page.tsx`'s own call site is unchanged.
 */
export function useCaseLog(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const queryKey = ['caseLog', organization.organizationId, caseId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchCaseLog(caseId, organization.organizationId),
  });

  const addEntry = useMutation({
    mutationFn: (input: NewCaseLogEntryClientInput) => createCaseLogEntry(caseId, organization.organizationId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { ...query, addEntry: addEntry.mutate };
}
