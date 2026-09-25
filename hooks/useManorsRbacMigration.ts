import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchManorsCaseNumberManageMigrationStatus, executeManorsCaseNumberManageMigration } from '@/lib/manorsRbacMigrationClient';

/** Manors RBAC production migration (2026-09). Same query/mutation-hook
    shape as `hooks/useCaseNumbering.ts`. */
const migrationStatusKey = (organizationId: string) => ['manorsCaseNumberManageMigrationStatus', organizationId];

export function useManorsCaseNumberManageMigrationStatus(organizationId: string) {
  return useQuery({
    queryKey: migrationStatusKey(organizationId),
    queryFn: () => fetchManorsCaseNumberManageMigrationStatus(organizationId),
    enabled: Boolean(organizationId),
  });
}

export function useExecuteManorsCaseNumberManageMigration(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => executeManorsCaseNumberManageMigration(organizationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: migrationStatusKey(organizationId) }),
  });
}
