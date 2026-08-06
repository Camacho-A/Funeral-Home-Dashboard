import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixResourceItem, buildWixResourceData, applyResourceUpdateToWixData, type WixResourceItem } from '../lib/wixResourceMapper';
import { mapWixResourceUnavailabilityItem, buildWixResourceUnavailabilityData, type WixResourceUnavailabilityItem } from '../lib/wixResourceUnavailabilityMapper';
import { mapWixAppointmentResourceAssignmentItem, type WixAppointmentResourceAssignmentItem } from '../lib/wixAppointmentResourceAssignmentMapper';
import type { Resource, ResourceType, ResourceStatus, NewResourceInput } from '../types/resource';
import type { ResourceUnavailability, NewResourceUnavailabilityInput } from '../types/resourceUnavailability';
import type { AppointmentResourceAssignment } from '../types/appointmentResourceAssignment';
import { assertStaffProfileIsActiveAndInOrganization } from './staffProfileService';
import { resourceFixtures, resourceUnavailabilityFixtures, appointmentResourceAssignmentFixtures } from './__mocks__/schedulingFixtures';

/**
 * Phase 27 (Scheduling & Resource Management). Pure `Resource`/
 * `ResourceUnavailability` CRUD and availability reads — no conflict
 * classification logic lives here (see services/scheduling/conflictEngine.ts
 * for hard-vs-soft classification) and no `Appointment`/
 * `AppointmentResourceAssignment` writes of any kind happen here (see
 * services/schedulingService.ts, the sole orchestration layer). Reading
 * `appointmentResourceAssignments` (via `getAvailability`) is fine — the
 * write-boundary invariant only restricts who may write that collection.
 */
export class ResourceServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

async function persistResource(resource: Resource, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    resourceFixtures.push(resource);
    return;
  }
  await insertWixDataItem<WixResourceItem>('resources', buildWixResourceData(resource), resource.id);
}

async function patchResource(
  organizationId: string,
  resourceId: string,
  patch: Partial<Pick<Resource, 'name' | 'locationId' | 'capacity' | 'notes' | 'status' | 'linkedStaffProfileId'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<Resource> {
  if (dataAdapterMode === 'mock') {
    const index = resourceFixtures.findIndex((r) => r.id === resourceId && r.organizationId === organizationId);
    if (index === -1) throw new ResourceServiceError('Resource not found.');
    resourceFixtures[index] = { ...resourceFixtures[index], ...patch };
    return resourceFixtures[index];
  }
  const response = await queryWixDataItems<WixResourceItem>('resources', { filter: { organizationId, beaconResourceId: resourceId }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new ResourceServiceError('Resource not found.');
  const merged = applyResourceUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixResourceItem>('resources', existingItem.id, merged);
  const mapped = mapWixResourceItem(updated.data);
  if (!mapped) throw new ResourceServiceError('Failed to update resource.');
  return mapped;
}

export async function list(
  organizationId: string,
  filters: { resourceType?: ResourceType; locationId?: string; status?: ResourceStatus } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Resource[]> {
  if (dataAdapterMode === 'mock') {
    return resourceFixtures.filter(
      (r) =>
        r.organizationId === organizationId &&
        (filters.resourceType === undefined || r.resourceType === filters.resourceType) &&
        (filters.locationId === undefined || r.locationId === filters.locationId) &&
        (filters.status === undefined || r.status === filters.status),
    );
  }
  const wixFilter: Record<string, unknown> = { organizationId };
  if (filters.resourceType) wixFilter.resourceType = filters.resourceType;
  if (filters.locationId) wixFilter.locationId = filters.locationId;
  if (filters.status) wixFilter.status = filters.status;
  const response = await queryWixDataItems<WixResourceItem>('resources', { filter: wixFilter });
  return response.dataItems.map((item) => mapWixResourceItem(item.data)).filter((r): r is Resource => r !== null);
}

export async function get(organizationId: string, resourceId: string, dataAdapterMode: DataAdapterMode): Promise<Resource | null> {
  if (dataAdapterMode === 'mock') {
    return resourceFixtures.find((r) => r.id === resourceId && r.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixResourceItem>('resources', { filter: { organizationId, beaconResourceId: resourceId }, paging: { limit: 1 } });
  return mapWixResourceItem(response.dataItems[0]?.data);
}

export async function create(
  organizationId: string,
  params: NewResourceInput & { idFactory: () => string; now?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<Resource> {
  // Phase 30 (Identity Model Hardening & Staff Assignment Unification): a
  // real, active, in-organization StaffProfile — existence + org match
  // only, never a full RBAC-gated assertAssignableStaffProfile check (a
  // Resource isn't a person being "assigned work" the way a Case/Task/
  // Appointment assignment is; resource.manage, already checked by the
  // caller route, is the only authorization this bridge needs).
  if (params.linkedStaffProfileId) {
    await assertStaffProfileIsActiveAndInOrganization(organizationId, params.linkedStaffProfileId, dataAdapterMode);
  }

  const now = params.now ?? nowIso();
  const resource: Resource = {
    id: params.idFactory(),
    organizationId,
    locationId: params.locationId ?? null,
    resourceType: params.resourceType,
    name: params.name,
    linkedMembershipId: params.linkedMembershipId ?? null,
    linkedStaffProfileId: params.linkedStaffProfileId ?? null,
    capacity: params.capacity ?? null,
    isExternal: params.isExternal ?? false,
    status: 'active',
    notes: params.notes ?? null,
    resourceVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  await persistResource(resource, dataAdapterMode);
  return resource;
}

export async function update(
  organizationId: string,
  resourceId: string,
  patch: { name?: string; locationId?: string | null; capacity?: number | null; notes?: string | null; linkedStaffProfileId?: string | null },
  dataAdapterMode: DataAdapterMode,
): Promise<Resource> {
  if (patch.linkedStaffProfileId) {
    await assertStaffProfileIsActiveAndInOrganization(organizationId, patch.linkedStaffProfileId, dataAdapterMode);
  }
  return patchResource(organizationId, resourceId, patch, dataAdapterMode);
}

export async function setStatus(organizationId: string, resourceId: string, status: ResourceStatus, dataAdapterMode: DataAdapterMode): Promise<Resource> {
  return patchResource(organizationId, resourceId, { status }, dataAdapterMode);
}

export async function listUnavailability(organizationId: string, resourceId: string, dataAdapterMode: DataAdapterMode): Promise<ResourceUnavailability[]> {
  if (dataAdapterMode === 'mock') {
    return resourceUnavailabilityFixtures.filter((u) => u.organizationId === organizationId && u.resourceId === resourceId);
  }
  const response = await queryWixDataItems<WixResourceUnavailabilityItem>('resourceUnavailability', { filter: { organizationId, resourceId } });
  return response.dataItems.map((item) => mapWixResourceUnavailabilityItem(item.data)).filter((u): u is ResourceUnavailability => u !== null);
}

export async function createUnavailability(
  organizationId: string,
  params: NewResourceUnavailabilityInput & { createdBy: string; idFactory: () => string; now?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<ResourceUnavailability> {
  const unavailability: ResourceUnavailability = {
    id: params.idFactory(),
    organizationId,
    resourceId: params.resourceId,
    startAt: params.startAt,
    endAt: params.endAt,
    reason: params.reason,
    notes: params.notes ?? null,
    createdBy: params.createdBy,
    createdAt: params.now ?? nowIso(),
  };
  if (dataAdapterMode === 'mock') {
    resourceUnavailabilityFixtures.push(unavailability);
    return unavailability;
  }
  await insertWixDataItem<WixResourceUnavailabilityItem>('resourceUnavailability', buildWixResourceUnavailabilityData(unavailability), unavailability.id);
  return unavailability;
}

/** The resource's booked windows for a range — every non-cancelled
    assignment and every unavailability window overlapping
    `[from, to)`. Returns raw candidates only; hard-vs-soft conflict
    classification is services/scheduling/conflictEngine.ts's job, not
    this function's — this is a pure read, reused by both that engine and
    the UI's live availability indicator so the query logic exists in
    exactly one place. */
export async function getAvailability(
  organizationId: string,
  resourceId: string,
  from: string,
  to: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ assignments: AppointmentResourceAssignment[]; unavailability: ResourceUnavailability[] }> {
  let assignments: AppointmentResourceAssignment[];
  if (dataAdapterMode === 'mock') {
    assignments = appointmentResourceAssignmentFixtures.filter((a) => a.organizationId === organizationId && a.resourceId === resourceId && a.releasedAt === null);
  } else {
    // Push down the two index-backed dimensions (organizationId, resourceId)
    // plus a coarse startAt upper bound, to keep what Wix scans small —
    // matching services/activityService.ts's own cursor-filter precedent.
    // The exact overlap boundary is still applied in application code below.
    const response = await queryWixDataItems<WixAppointmentResourceAssignmentItem>('appointmentResourceAssignments', {
      filter: { organizationId, resourceId, startAt: { $lt: to } },
    });
    assignments = response.dataItems
      .map((item) => mapWixAppointmentResourceAssignmentItem(item.data))
      .filter((a): a is AppointmentResourceAssignment => a !== null && a.releasedAt === null);
  }
  const overlappingAssignments = assignments.filter((a) => a.startAt < to && a.endAt > from);

  const unavailability = await listUnavailability(organizationId, resourceId, dataAdapterMode);
  const overlappingUnavailability = unavailability.filter((u) => u.startAt < to && u.endAt > from);

  return { assignments: overlappingAssignments, unavailability: overlappingUnavailability };
}
