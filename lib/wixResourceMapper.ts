import type { Resource, ResourceType, ResourceStatus } from '../types/resource';

/**
 * Phase 27 (Scheduling & Resource Management). Standard mapper pair for
 * the `resources` collection, matching every existing mapper's full
 * runtime type-guarding, null-not-throw convention (see e.g.
 * `lib/wixCaseDocumentMapper.ts`).
 */

export type WixResourceItem = {
  beaconResourceId?: unknown;
  organizationId?: unknown;
  locationId?: unknown;
  resourceType?: unknown;
  name?: unknown;
  linkedMembershipId?: unknown;
  capacity?: unknown;
  isExternal?: unknown;
  status?: unknown;
  notes?: unknown;
  resourceVersion?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_RESOURCE_TYPES: readonly string[] = [
  'funeral_director',
  'staff',
  'vehicle',
  'chapel',
  'viewing_room',
  'meeting_room',
  'crematory',
  'cemetery',
  'equipment',
  'external_vendor',
];

const VALID_RESOURCE_STATUSES: readonly string[] = ['active', 'maintenance', 'out_of_service', 'archived'];

function isResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && VALID_RESOURCE_TYPES.includes(value);
}

function isResourceStatus(value: unknown): value is ResourceStatus {
  return typeof value === 'string' && VALID_RESOURCE_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

export function mapWixResourceItem(item: WixResourceItem | undefined): Resource | null {
  if (
    !item ||
    typeof item.beaconResourceId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    !isStringOrNull(item.locationId) ||
    !isResourceType(item.resourceType) ||
    typeof item.name !== 'string' ||
    !isStringOrNull(item.linkedMembershipId) ||
    !isNumberOrNull(item.capacity) ||
    typeof item.isExternal !== 'boolean' ||
    !isResourceStatus(item.status) ||
    !isStringOrNull(item.notes) ||
    typeof item.resourceVersion !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconResourceId,
    organizationId: item.organizationId,
    locationId: item.locationId,
    resourceType: item.resourceType,
    name: item.name,
    linkedMembershipId: item.linkedMembershipId,
    capacity: item.capacity,
    isExternal: item.isExternal,
    status: item.status,
    notes: item.notes,
    resourceVersion: item.resourceVersion,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixResourceData(resource: Resource): WixResourceItem {
  return {
    beaconResourceId: resource.id,
    organizationId: resource.organizationId,
    locationId: resource.locationId,
    resourceType: resource.resourceType,
    name: resource.name,
    linkedMembershipId: resource.linkedMembershipId,
    capacity: resource.capacity,
    isExternal: resource.isExternal,
    status: resource.status,
    notes: resource.notes,
    resourceVersion: resource.resourceVersion,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

/** The only fields `resourceService.ts`'s `update`/`setStatus` ever
    change on an existing row. */
export function applyResourceUpdateToWixData(
  existing: WixResourceItem,
  patch: Partial<Pick<WixResourceItem, 'name' | 'locationId' | 'capacity' | 'notes' | 'status'>>,
): WixResourceItem {
  return { ...existing, ...patch };
}
