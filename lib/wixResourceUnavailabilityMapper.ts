import type { ResourceUnavailability, ResourceUnavailabilityReason } from '../types/resourceUnavailability';

/**
 * Phase 27 (Scheduling & Resource Management). Standard mapper pair for
 * the `resourceUnavailability` collection. No update/apply function —
 * every row is a fixed, immutable statement of "this resource was
 * unavailable from A to B"; a correction is always a new row (create one,
 * and if the original was wrong, it is simply superseded in the UI by not
 * being shown — the service layer never edits or deletes one).
 */

export type WixResourceUnavailabilityItem = {
  beaconResourceUnavailabilityId?: unknown;
  organizationId?: unknown;
  resourceId?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  reason?: unknown;
  notes?: unknown;
  createdBy?: unknown;
  createdAt?: unknown;
};

const VALID_REASONS: readonly string[] = ['maintenance', 'time_off', 'other'];

function isReason(value: unknown): value is ResourceUnavailabilityReason {
  return typeof value === 'string' && VALID_REASONS.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixResourceUnavailabilityItem(item: WixResourceUnavailabilityItem | undefined): ResourceUnavailability | null {
  if (
    !item ||
    typeof item.beaconResourceUnavailabilityId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.resourceId !== 'string' ||
    typeof item.startAt !== 'string' ||
    typeof item.endAt !== 'string' ||
    !isReason(item.reason) ||
    !isStringOrNull(item.notes) ||
    typeof item.createdBy !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconResourceUnavailabilityId,
    organizationId: item.organizationId,
    resourceId: item.resourceId,
    startAt: item.startAt,
    endAt: item.endAt,
    reason: item.reason,
    notes: item.notes,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
  };
}

export function buildWixResourceUnavailabilityData(unavailability: ResourceUnavailability): WixResourceUnavailabilityItem {
  return {
    beaconResourceUnavailabilityId: unavailability.id,
    organizationId: unavailability.organizationId,
    resourceId: unavailability.resourceId,
    startAt: unavailability.startAt,
    endAt: unavailability.endAt,
    reason: unavailability.reason,
    notes: unavailability.notes,
    createdBy: unavailability.createdBy,
    createdAt: unavailability.createdAt,
  };
}
