import type { CalendarFeedToken, CalendarFeedTokenScope } from '../types/calendarFeedToken';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Standard mapper pair for the `calendarFeedTokens`
 * collection — `tokenHash` is the only token-derived field ever
 * persisted, see `types/calendarFeedToken.ts`'s own header comment.
 */
export type WixCalendarFeedTokenItem = {
  beaconCalendarFeedTokenId?: unknown;
  organizationId?: unknown;
  tokenHash?: unknown;
  scope?: unknown;
  ownerStaffProfileId?: unknown;
  createdAt?: unknown;
  revokedAt?: unknown;
  lastAccessedAt?: unknown;
};

const VALID_SCOPES: readonly string[] = ['staff_own'];

function isScope(value: unknown): value is CalendarFeedTokenScope {
  return typeof value === 'string' && VALID_SCOPES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixCalendarFeedTokenItem(item: WixCalendarFeedTokenItem | undefined): CalendarFeedToken | null {
  if (
    !item ||
    typeof item.beaconCalendarFeedTokenId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.tokenHash !== 'string' ||
    !isScope(item.scope) ||
    typeof item.ownerStaffProfileId !== 'string' ||
    typeof item.createdAt !== 'string' ||
    !isStringOrNull(item.revokedAt) ||
    !isStringOrNull(item.lastAccessedAt)
  ) {
    return null;
  }

  return {
    id: item.beaconCalendarFeedTokenId,
    organizationId: item.organizationId,
    tokenHash: item.tokenHash,
    scope: item.scope,
    ownerStaffProfileId: item.ownerStaffProfileId,
    createdAt: item.createdAt,
    revokedAt: item.revokedAt,
    lastAccessedAt: item.lastAccessedAt,
  };
}

export function buildWixCalendarFeedTokenData(token: CalendarFeedToken): WixCalendarFeedTokenItem {
  return {
    beaconCalendarFeedTokenId: token.id,
    organizationId: token.organizationId,
    tokenHash: token.tokenHash,
    scope: token.scope,
    ownerStaffProfileId: token.ownerStaffProfileId,
    createdAt: token.createdAt,
    revokedAt: token.revokedAt,
    lastAccessedAt: token.lastAccessedAt,
  };
}

export function applyCalendarFeedTokenUpdateToWixData(
  existing: WixCalendarFeedTokenItem,
  patch: Partial<Pick<CalendarFeedToken, 'revokedAt' | 'lastAccessedAt'>>,
): WixCalendarFeedTokenItem {
  const next = { ...existing };
  if (patch.revokedAt !== undefined) next.revokedAt = patch.revokedAt;
  if (patch.lastAccessedAt !== undefined) next.lastAccessedAt = patch.lastAccessedAt;
  return next;
}
