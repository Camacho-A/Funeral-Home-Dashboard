import { useQuery } from '@tanstack/react-query';
import * as staffProfileService from '@/services/staffProfileService';
import { useOrganization } from './useOrganization';

export function useStaff() {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['staff', organization.organizationId],
    queryFn: () => staffProfileService.list(organization.organizationId, organization.dataAdapterMode),
  });
}
