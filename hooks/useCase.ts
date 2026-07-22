import { useQuery } from '@tanstack/react-query';
import { casesService } from '@/services/casesService';
import { useOrganization } from './useOrganization';

/**
 * Takes a plain `caseId: string` — never a route param directly. See the
 * "Route/feature decoupling" principle in the Frontend Engineering Plan;
 * only the page component (app/(portal)/cases/[caseId]/page.tsx) reads
 * `params`.
 */
export function useCase(caseId: string) {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['case', organization.organizationId, caseId],
    queryFn: () => casesService.get(organization, caseId, organization.dataAdapterMode),
  });
}
