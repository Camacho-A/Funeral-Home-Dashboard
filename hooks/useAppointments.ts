import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAppointments,
  fetchCaseAppointments,
  fetchAppointment,
  createAppointment,
  rescheduleAppointment,
  updateAppointmentResources,
  confirmAppointment,
  cancelAppointment,
  completeAppointment,
  type NewAppointmentParams,
} from '@/lib/appointmentsClient';
import type { AppointmentStatus } from '@/types/appointment';

/**
 * Phase 27 (Scheduling & Resource Management). Query/mutation hooks for
 * the Calendar page and the Case Schedule tab — same shape as
 * `hooks/useActivity.ts`/`hooks/useSignatureRequests.ts`. Every mutation
 * invalidates both the org-wide `appointments` key prefix (partial match —
 * TanStack Query invalidates every filtered variant under it, e.g. the
 * Calendar's current date range) and the case-scoped key, since either
 * surface may be showing the appointment being changed.
 */
type AppointmentFilters = { from?: string; to?: string; caseId?: string; resourceId?: string; status?: AppointmentStatus };

const appointmentsKey = (organizationId: string, filters: AppointmentFilters) => ['appointments', organizationId, filters];
const caseAppointmentsKey = (organizationId: string, caseId: string) => ['caseAppointments', organizationId, caseId];
const appointmentKey = (organizationId: string, appointmentId: string) => ['appointment', organizationId, appointmentId];

export function useAppointments(organizationId: string, filters: AppointmentFilters = {}) {
  return useQuery({
    queryKey: appointmentsKey(organizationId, filters),
    queryFn: () => fetchAppointments(organizationId, filters),
    enabled: Boolean(organizationId),
  });
}

export function useCaseAppointments(organizationId: string, caseId: string) {
  return useQuery({
    queryKey: caseAppointmentsKey(organizationId, caseId),
    queryFn: () => fetchCaseAppointments(organizationId, caseId),
    enabled: Boolean(organizationId && caseId),
  });
}

export function useAppointmentDetail(organizationId: string, appointmentId: string | null) {
  return useQuery({
    queryKey: appointmentKey(organizationId, appointmentId ?? ''),
    queryFn: () => fetchAppointment(organizationId, appointmentId as string),
    enabled: Boolean(organizationId && appointmentId),
  });
}

function useInvalidateAppointments(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['appointments', organizationId] });
    queryClient.invalidateQueries({ queryKey: ['caseAppointments', organizationId] });
    queryClient.invalidateQueries({ queryKey: ['appointment', organizationId] });
  };
}

export function useCreateAppointment(organizationId: string) {
  const invalidate = useInvalidateAppointments(organizationId);
  return useMutation({
    mutationFn: (params: Omit<NewAppointmentParams, 'organizationId'>) => createAppointment({ organizationId, ...params }),
    onSuccess: invalidate,
  });
}

export function useRescheduleAppointment(organizationId: string) {
  const invalidate = useInvalidateAppointments(organizationId);
  return useMutation({
    mutationFn: ({ appointmentId, changes, override }: { appointmentId: string; changes: { startAt: string; endAt: string }; override?: { reason: string } }) =>
      rescheduleAppointment(organizationId, appointmentId, changes, override),
    onSuccess: invalidate,
  });
}

export function useUpdateAppointmentResources(organizationId: string) {
  const invalidate = useInvalidateAppointments(organizationId);
  return useMutation({
    mutationFn: ({
      appointmentId,
      changes,
      override,
    }: {
      appointmentId: string;
      changes: { addResourceIds?: string[]; removeResourceIds?: string[] };
      override?: { reason: string };
    }) => updateAppointmentResources(organizationId, appointmentId, changes, override),
    onSuccess: invalidate,
  });
}

export function useConfirmAppointment(organizationId: string) {
  const invalidate = useInvalidateAppointments(organizationId);
  return useMutation({
    mutationFn: (appointmentId: string) => confirmAppointment(organizationId, appointmentId),
    onSuccess: invalidate,
  });
}

export function useCancelAppointment(organizationId: string) {
  const invalidate = useInvalidateAppointments(organizationId);
  return useMutation({
    mutationFn: ({ appointmentId, reason }: { appointmentId: string; reason?: string }) => cancelAppointment(organizationId, appointmentId, reason),
    onSuccess: invalidate,
  });
}

export function useCompleteAppointment(organizationId: string) {
  const invalidate = useInvalidateAppointments(organizationId);
  return useMutation({
    mutationFn: ({ appointmentId, outcome }: { appointmentId: string; outcome: 'completed' | 'no_show' }) => completeAppointment(organizationId, appointmentId, outcome),
    onSuccess: invalidate,
  });
}
