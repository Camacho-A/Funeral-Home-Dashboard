import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createExpectedPickup, updateExpectedPickupDate } from '@/lib/cremainsPickupClient';

/**
 * Expected Cremains Pickup mutations (2026-10). Both invalidate the case's
 * appointment list so the dedicated section AND the generic Schedule list
 * re-read from the server's own response — never an optimistic guess about
 * a date the server may have adjusted or refused.
 */
const caseAppointmentsKey = (organizationId: string, caseId: string) => ['caseAppointments', organizationId, caseId];

function useInvalidate(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: caseAppointmentsKey(organizationId, caseId) });
    // The calendar reads a different key; refresh it so a newly entered
    // pickup appears there without a reload.
    queryClient.invalidateQueries({ queryKey: ['appointments', organizationId] });
  };
}

export function useCreateExpectedPickup(organizationId: string, caseId: string) {
  const invalidate = useInvalidate(organizationId, caseId);
  return useMutation({
    mutationFn: (input: { expectedDate: string; notes?: string | null; reason?: string | null }) =>
      createExpectedPickup(caseId, { organizationId, ...input }),
    onSuccess: invalidate,
  });
}

export function useUpdateExpectedPickupDate(organizationId: string, caseId: string) {
  const invalidate = useInvalidate(organizationId, caseId);
  return useMutation({
    mutationFn: (input: { expectedDate: string; reason?: string | null }) =>
      updateExpectedPickupDate(caseId, { organizationId, ...input }),
    onSuccess: invalidate,
  });
}
