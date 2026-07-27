import type { OnboardingAuditEntry } from '../types/onboardingAudit';

/**
 * Append-only, same as lib/wixCaseOrderAuditMapper.ts — no update helper,
 * only map/build.
 */
export type WixOnboardingAuditItem = {
  beaconAuditEntryId?: unknown;
  organizationId?: unknown;
  actorUserId?: unknown;
  action?: unknown;
  metadata?: unknown;
  timestamp?: unknown;
};

function isMetadataRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}

export function mapWixOnboardingAuditItem(item: WixOnboardingAuditItem | undefined): OnboardingAuditEntry | null {
  if (
    !item ||
    typeof item.beaconAuditEntryId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.actorUserId !== 'string' ||
    typeof item.action !== 'string' ||
    typeof item.timestamp !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconAuditEntryId,
    organizationId: item.organizationId,
    actorUserId: item.actorUserId,
    action: item.action,
    metadata: isMetadataRecord(item.metadata) ? item.metadata : null,
    timestamp: item.timestamp,
  };
}

export function buildWixOnboardingAuditData(entry: OnboardingAuditEntry): WixOnboardingAuditItem {
  return {
    beaconAuditEntryId: entry.id,
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    metadata: entry.metadata,
    timestamp: entry.timestamp,
  };
}
