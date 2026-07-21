import { useQuery } from '@tanstack/react-query';
import { staffService } from '@/services/staffService';
import { useOrganization } from './useOrganization';

export function useStaff() {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['staff', organization.organizationId],
    queryFn: () => staffService.list(organization),
  });
}
