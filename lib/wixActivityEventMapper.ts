import type { ActivityEvent, ActivityEventCategory, ActivitySeverity } from '../types/activityEvent';

const VALID_CATEGORIES: ActivityEventCategory[] = [
  'authentication',
  'team_management',
  'cases',
  'payments',
  'documents',
  'workflow',
  'scheduling',
  'inventory',
  'notifications',
  'administration',
  'system',
  'family_portal',
];

const VALID_SEVERITIES: ActivitySeverity[] = ['info', 'warning', 'critical'];

/** Exported so route handlers can validate a client-supplied `category`/
    `severity` query param against the same list this mapper enforces —
    one source of truth, never duplicated. */
export function isValidActivityCategory(value: unknown): value is ActivityEventCategory {
  return typeof value === 'string' && (VALID_CATEGORIES as string[]).includes(value);
}

export function isValidActivitySeverity(value: unknown): value is ActivitySeverity {
  return typeof value === 'string' && (VALID_SEVERITIES as string[]).includes(value);
}

export type WixActivityEventItem = {
  beaconActivityEventId?: unknown;
  eventVersion?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  actorIdentityId?: unknown;
  actorMembershipId?: unknown;
  actorRoleKey?: unknown;
  category?: unknown;
  eventType?: unknown;
  resourceType?: unknown;
  resourceId?: unknown;
  previousValue?: unknown;
  newValue?: unknown;
  description?: unknown;
  metadata?: unknown;
  severity?: unknown;
  correlationId?: unknown;
  isSystemGenerated?: unknown;
  createdAt?: unknown;
};

export function mapWixActivityEventItem(item: WixActivityEventItem | undefined): ActivityEvent | null {
  if (
    !item ||
    typeof item.beaconActivityEventId !== 'string' ||
    typeof item.eventVersion !== 'number' ||
    typeof item.organizationId !== 'string' ||
    typeof item.category !== 'string' ||
    !isValidActivityCategory(item.category) ||
    typeof item.eventType !== 'string' ||
    typeof item.resourceType !== 'string' ||
    typeof item.description !== 'string' ||
    typeof item.severity !== 'string' ||
    !isValidActivitySeverity(item.severity) ||
    typeof item.isSystemGenerated !== 'boolean' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconActivityEventId,
    eventVersion: item.eventVersion,
    organizationId: item.organizationId,
    caseId: typeof item.caseId === 'string' ? item.caseId : null,
    actorIdentityId: typeof item.actorIdentityId === 'string' ? item.actorIdentityId : null,
    actorMembershipId: typeof item.actorMembershipId === 'string' ? item.actorMembershipId : null,
    actorRoleKey: typeof item.actorRoleKey === 'string' ? item.actorRoleKey : null,
    category: item.category,
    eventType: item.eventType,
    resourceType: item.resourceType,
    resourceId: typeof item.resourceId === 'string' ? item.resourceId : null,
    previousValue: typeof item.previousValue === 'string' ? item.previousValue : null,
    newValue: typeof item.newValue === 'string' ? item.newValue : null,
    description: item.description,
    metadata: typeof item.metadata === 'string' ? item.metadata : null,
    severity: item.severity,
    correlationId: typeof item.correlationId === 'string' ? item.correlationId : null,
    isSystemGenerated: item.isSystemGenerated,
    createdAt: item.createdAt,
  };
}

export function buildWixActivityEventData(event: ActivityEvent): WixActivityEventItem {
  return {
    beaconActivityEventId: event.id,
    eventVersion: event.eventVersion,
    organizationId: event.organizationId,
    caseId: event.caseId,
    actorIdentityId: event.actorIdentityId,
    actorMembershipId: event.actorMembershipId,
    actorRoleKey: event.actorRoleKey,
    category: event.category,
    eventType: event.eventType,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    previousValue: event.previousValue,
    newValue: event.newValue,
    description: event.description,
    metadata: event.metadata,
    severity: event.severity,
    correlationId: event.correlationId,
    isSystemGenerated: event.isSystemGenerated,
    createdAt: event.createdAt,
  };
}
