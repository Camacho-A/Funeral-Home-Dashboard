import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NewCaseInput } from '@/types/case';
import { casesService } from '@/services/casesService';
import { useOrganization } from './useOrganization';
import { useSession } from './useSession';

/**
 * `session` (the trusted current staff member) is read here, from
 * useSession(), and passed to casesService.create as its own parameter —
 * never as part of the mutation's `input` payload. That's what keeps the
 * New Case form from ever being able to supply createdBy/intakeOwnerId
 * itself: NewCaseModal only ever builds a NewCaseInput, which has no field
 * for either.
 */
export function useCreateCase() {
  const organization = useOrganization();
  const session = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewCaseInput) => casesService.create(organization, input, session),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
    },
  });
}
