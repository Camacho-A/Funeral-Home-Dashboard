import { useQuery } from '@tanstack/react-query';
import { tasksService, type TaskFilters } from '@/services/tasksService';
import { useOrganization } from './useOrganization';

export function useTasks(filters: TaskFilters = {}) {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['tasks', organization.organizationId, filters],
    queryFn: () => tasksService.list(organization, filters),
  });
}
