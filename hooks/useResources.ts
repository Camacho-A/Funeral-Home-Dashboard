import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchResources,
  createResource,
  updateResource,
  setResourceStatus,
  fetchResourceAvailability,
  createResourceUnavailability,
} from '@/lib/resourcesClient';
import type { ResourceType, ResourceStatus, NewResourceInput } from '@/types/resource';
import type { ResourceUnavailabilityReason } from '@/types/resourceUnavailability';

/**
 * Phase 27 (Scheduling & Resource Management). Query/mutation hooks for
 * the Calendar page's resource-filter sidebar, `AppointmentDialog`'s
 * resource multi-select + live availability indicator, and the Resource
 * Calendar (Settings) page — same shape as `hooks/useAppointments.ts`.
 */
const resourcesKey = (organizationId: string, filters: { resourceType?: ResourceType; locationId?: string } = {}) => ['resources', organizationId, filters];
const availabilityKey = (organizationId: string, resourceId: string, from: string, to: string) => ['resourceAvailability', organizationId, resourceId, from, to];

export function useResources(organizationId: string, filters: { resourceType?: ResourceType; locationId?: string } = {}) {
  return useQuery({
    queryKey: resourcesKey(organizationId, filters),
    queryFn: () => fetchResources(organizationId, filters),
    enabled: Boolean(organizationId),
  });
}

export function useResourceAvailability(organizationId: string, resourceId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: availabilityKey(organizationId, resourceId ?? '', from, to),
    queryFn: () => fetchResourceAvailability(organizationId, resourceId as string, from, to),
    enabled: Boolean(organizationId && resourceId && from && to),
  });
}

function useInvalidateResources(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['resources', organizationId] });
    queryClient.invalidateQueries({ queryKey: ['resourceAvailability', organizationId] });
  };
}

export function useCreateResource(organizationId: string) {
  const invalidate = useInvalidateResources(organizationId);
  return useMutation({
    mutationFn: (params: NewResourceInput) => createResource({ organizationId, ...params }),
    onSuccess: invalidate,
  });
}

export function useUpdateResource(organizationId: string) {
  const invalidate = useInvalidateResources(organizationId);
  return useMutation({
    mutationFn: ({ resourceId, patch }: { resourceId: string; patch: { name?: string; locationId?: string | null; capacity?: number | null; notes?: string | null } }) =>
      updateResource(organizationId, resourceId, patch),
    onSuccess: invalidate,
  });
}

export function useSetResourceStatus(organizationId: string) {
  const invalidate = useInvalidateResources(organizationId);
  return useMutation({
    mutationFn: ({ resourceId, status }: { resourceId: string; status: ResourceStatus }) => setResourceStatus(organizationId, resourceId, status),
    onSuccess: invalidate,
  });
}

export function useCreateResourceUnavailability(organizationId: string) {
  const invalidate = useInvalidateResources(organizationId);
  return useMutation({
    mutationFn: ({ resourceId, params }: { resourceId: string; params: { startAt: string; endAt: string; reason: ResourceUnavailabilityReason; notes?: string } }) =>
      createResourceUnavailability(organizationId, resourceId, params),
    onSuccess: invalidate,
  });
}
