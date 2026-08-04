import type { Resource, ResourceType, ResourceStatus } from '@/types/resource';
import type { ResourceUnavailability, ResourceUnavailabilityReason } from '@/types/resourceUnavailability';
import type { AppointmentResourceAssignment } from '@/types/appointmentResourceAssignment';

/**
 * Phase 27 (Scheduling & Resource Management). Client-side fetch wrappers
 * around `/api/scheduling/resources/*` — `services/resourceService.ts`
 * can never be called from a Client Component directly, matching
 * `lib/appointmentsClient.ts`'s own reasoning.
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchResources(organizationId: string, filters: { resourceType?: ResourceType; locationId?: string } = {}): Promise<Resource[]> {
  const params = new URLSearchParams({ organizationId });
  if (filters.resourceType) params.set('resourceType', filters.resourceType);
  if (filters.locationId) params.set('locationId', filters.locationId);
  const response = await fetch(`/api/scheduling/resources?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.resources as Resource[]) ?? [];
}

export async function createResource(params: {
  organizationId: string;
  resourceType: ResourceType;
  name: string;
  locationId?: string;
  linkedMembershipId?: string;
  capacity?: number;
  isExternal?: boolean;
  notes?: string;
}): Promise<Resource> {
  const response = await fetch('/api/scheduling/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return body.resource as Resource;
}

export async function updateResource(
  organizationId: string,
  resourceId: string,
  patch: { name?: string; locationId?: string | null; capacity?: number | null; notes?: string | null },
): Promise<Resource> {
  const response = await fetch(`/api/scheduling/resources/${encodeURIComponent(resourceId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, ...patch }),
  });
  const body = await parseJsonOrThrow(response);
  return body.resource as Resource;
}

export async function setResourceStatus(organizationId: string, resourceId: string, status: ResourceStatus): Promise<Resource> {
  const response = await fetch(`/api/scheduling/resources/${encodeURIComponent(resourceId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, status }),
  });
  const body = await parseJsonOrThrow(response);
  return body.resource as Resource;
}

export async function fetchResourceAvailability(
  organizationId: string,
  resourceId: string,
  from: string,
  to: string,
): Promise<{ assignments: AppointmentResourceAssignment[]; unavailability: ResourceUnavailability[] }> {
  const params = new URLSearchParams({ organizationId, from, to });
  const response = await fetch(`/api/scheduling/resources/${encodeURIComponent(resourceId)}/availability?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return { assignments: (body.assignments as AppointmentResourceAssignment[]) ?? [], unavailability: (body.unavailability as ResourceUnavailability[]) ?? [] };
}

export async function createResourceUnavailability(
  organizationId: string,
  resourceId: string,
  params: { startAt: string; endAt: string; reason: ResourceUnavailabilityReason; notes?: string },
): Promise<ResourceUnavailability> {
  const response = await fetch(`/api/scheduling/resources/${encodeURIComponent(resourceId)}/unavailability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, ...params }),
  });
  const body = await parseJsonOrThrow(response);
  return body.unavailability as ResourceUnavailability;
}
