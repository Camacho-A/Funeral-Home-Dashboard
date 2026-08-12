import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixCalendarFeedTokenItem, buildWixCalendarFeedTokenData, applyCalendarFeedTokenUpdateToWixData, type WixCalendarFeedTokenItem } from '../lib/wixCalendarFeedTokenMapper';
import type { CalendarFeedToken } from '../types/calendarFeedToken';
import { generateToken, hashToken } from '../lib/identity/tokens';
import { calendarFeedTokenFixtures } from './__mocks__/calendarFixtures';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). The sole writer of `calendarFeedTokens`. Reuses
 * `lib/identity/tokens.ts`'s existing `generateToken`/`hashToken`
 * (the same primitive `EmailVerificationToken`/`PasswordResetToken`
 * already use) rather than a second hashing implementation — hash-at-rest,
 * the raw token returned exactly once, at generation time, from
 * `generateFeedToken` below, and never persisted or logged anywhere
 * past that single return value.
 */

export class CalendarFeedTokenServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

async function findTokenById(id: string, dataAdapterMode: DataAdapterMode): Promise<CalendarFeedToken | null> {
  if (dataAdapterMode === 'mock') {
    return calendarFeedTokenFixtures.find((t) => t.id === id) ?? null;
  }
  const response = await queryWixDataItems<WixCalendarFeedTokenItem>('calendarFeedTokens', { filter: { beaconCalendarFeedTokenId: id }, paging: { limit: 1 } });
  return mapWixCalendarFeedTokenItem(response.dataItems[0]?.data);
}

async function patchToken(
  organizationId: string,
  id: string,
  patch: Partial<Pick<CalendarFeedToken, 'revokedAt' | 'lastAccessedAt'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<CalendarFeedToken> {
  if (dataAdapterMode === 'mock') {
    const index = calendarFeedTokenFixtures.findIndex((t) => t.id === id && t.organizationId === organizationId);
    if (index === -1) throw new CalendarFeedTokenServiceError('Calendar feed token not found.');
    calendarFeedTokenFixtures[index] = { ...calendarFeedTokenFixtures[index], ...patch };
    return calendarFeedTokenFixtures[index];
  }
  const response = await queryWixDataItems<WixCalendarFeedTokenItem>('calendarFeedTokens', { filter: { organizationId, beaconCalendarFeedTokenId: id }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new CalendarFeedTokenServiceError('Calendar feed token not found.');
  const merged = applyCalendarFeedTokenUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixCalendarFeedTokenItem>('calendarFeedTokens', existingItem.id, merged);
  const mapped = mapWixCalendarFeedTokenItem(updated.data);
  if (!mapped) throw new CalendarFeedTokenServiceError('Failed to update calendar feed token.');
  return mapped;
}

/** Every token for a given StaffProfile, including revoked ones (the
    Settings UI shows revocation history) — the raw token is never
    included, only ever the row's own metadata. */
export async function listTokensForStaffProfile(organizationId: string, staffProfileId: string, dataAdapterMode: DataAdapterMode): Promise<CalendarFeedToken[]> {
  if (dataAdapterMode === 'mock') {
    return calendarFeedTokenFixtures.filter((t) => t.organizationId === organizationId && t.ownerStaffProfileId === staffProfileId);
  }
  const response = await queryWixDataItems<WixCalendarFeedTokenItem>('calendarFeedTokens', { filter: { organizationId, ownerStaffProfileId: staffProfileId } });
  return response.dataItems.map((item) => mapWixCalendarFeedTokenItem(item.data)).filter((t): t is CalendarFeedToken => t !== null);
}

export type GeneratedFeedToken = { token: CalendarFeedToken; rawToken: string };

/** Mints a new `staff_own` feed token. Never revokes any existing token
    for this StaffProfile — a "regenerate" action is the caller's own
    two-step composition (revoke the old row, then call this), giving
    the UI a chance to confirm the old link truly stops working before
    committing to the new one. */
export async function generateFeedToken(organizationId: string, staffProfileId: string, idFactory: () => string, dataAdapterMode: DataAdapterMode): Promise<GeneratedFeedToken> {
  const { token: rawToken, tokenHash } = generateToken();
  const now = nowIso();
  const token: CalendarFeedToken = {
    id: idFactory(),
    organizationId,
    tokenHash,
    scope: 'staff_own',
    ownerStaffProfileId: staffProfileId,
    createdAt: now,
    revokedAt: null,
    lastAccessedAt: null,
  };

  if (dataAdapterMode === 'mock') {
    calendarFeedTokenFixtures.push(token);
    return { token, rawToken };
  }
  await insertWixDataItem<WixCalendarFeedTokenItem>('calendarFeedTokens', buildWixCalendarFeedTokenData(token), token.id);
  return { token, rawToken };
}

export async function revokeFeedToken(organizationId: string, tokenId: string, dataAdapterMode: DataAdapterMode): Promise<CalendarFeedToken> {
  return patchToken(organizationId, tokenId, { revokedAt: nowIso() }, dataAdapterMode);
}

/** Hashes the incoming raw token and looks it up by hash — never a
    plaintext-token query, mirroring `EmailVerificationToken`'s own
    `findTokenByHash` idiom. Returns `null` for anything not found OR
    already revoked (a revoked token is treated identically to a
    nonexistent one — the feed route never distinguishes the two, so a
    prior link's exact failure mode isn't discoverable by probing). This
    is deliberately org-agnostic (a feed URL carries no organizationId of
    its own) — the one call site allowed to do so; see the feed route's
    own comment. */
export async function resolveFeedToken(rawToken: string, dataAdapterMode: DataAdapterMode): Promise<CalendarFeedToken | null> {
  const tokenHash = hashToken(rawToken);
  let record: CalendarFeedToken | null;
  if (dataAdapterMode === 'mock') {
    record = calendarFeedTokenFixtures.find((t) => t.tokenHash === tokenHash) ?? null;
  } else {
    const response = await queryWixDataItems<WixCalendarFeedTokenItem>('calendarFeedTokens', { filter: { tokenHash }, paging: { limit: 1 } });
    record = mapWixCalendarFeedTokenItem(response.dataItems[0]?.data);
  }
  if (!record || record.revokedAt !== null) return null;
  return record;
}

/** Best-effort visibility only — never blocks the feed response itself
    if the write fails. */
export async function touchFeedTokenAccess(token: CalendarFeedToken, dataAdapterMode: DataAdapterMode): Promise<void> {
  try {
    await patchToken(token.organizationId, token.id, { lastAccessedAt: nowIso() }, dataAdapterMode);
  } catch (error) {
    console.error('Failed to update calendar feed token lastAccessedAt:', error instanceof Error ? error.message : error);
  }
}

export { findTokenById as getFeedTokenById };
