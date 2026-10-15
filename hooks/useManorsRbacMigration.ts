import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchManorsCaseNumberManageMigrationStatus,
  executeManorsCaseNumberManageMigration,
  isManorsRbacMigrationOrganization,
} from '@/lib/manorsRbacMigrationClient';

/** Manors RBAC production migration (2026-09). Same query/mutation-hook
    shape as `hooks/useCaseNumbering.ts`.
    Safe onboarding (2026-10): the status query is only ever enabled for
    the Manors organization, so no request is made (and the control never
    renders) for Gus or any other tenant. */
const migrationStatusKey = (organizationId: string) => ['manorsCaseNumberManageMigrationStatus', organizationId];

export function useManorsCaseNumberManageMigrationStatus(organizationId: string) {
  return useQuery({
    queryKey: migrationStatusKey(organizationId),
    queryFn: () => fetchManorsCaseNumberManageMigrationStatus(organizationId),
    enabled: isManorsRbacMigrationOrganization(organizationId),
  });
}

export function useExecuteManorsCaseNumberManageMigration(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => executeManorsCaseNumberManageMigration(organizationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: migrationStatusKey(organizationId) }),
  });
}
