import type { DataAdapterMode } from '../lib/env';

/**
 * Whether service preparation may be SAVED in this data mode (Gus Phase
 * 5C/5E). Its own module so the switch has one obvious home.
 *
 * The live Wix `cases` field `servicePreparation` was added and verified
 * on 2026-11-17 (Phase 5D), but saving to live Wix stays OFF until it is
 * separately approved. While false, a Wix-mode save is refused before
 * anything is sent to Wix. Reads are always safe.
 */
export const SERVICE_PREPARATION_WIX_FIELD_ADDED = false;

export function servicePreparationStorageAvailable(mode: DataAdapterMode): boolean {
  return mode === 'mock' || SERVICE_PREPARATION_WIX_FIELD_ADDED;
}
