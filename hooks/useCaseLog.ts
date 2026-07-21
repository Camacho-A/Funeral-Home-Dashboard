import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NewCaseLogEntryInput } from '@/types/caseLogEntry';
import { caseLogService } from '@/services/caseLogService';
import { useOrganization } from './useOrganization';

export function useCaseLog(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const queryKey = ['caseLog', organization.organizationId, caseId];

  const query = useQuery({
    queryKey,
    queryFn: () => caseLogService.list(organization, caseId),
  });

  const addEntry = useMutation({
    mutationFn: (input: NewCaseLogEntryInput) => caseLogService.create(organization, caseId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { ...query, addEntry: addEntry.mutate };
}
