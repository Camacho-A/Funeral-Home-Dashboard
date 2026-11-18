import { conditionalPatchWixDataItemFields, insertWixDataItem, queryWixDataItems, WixDataApiError } from '../lib/wixDataApi';
import type { DataAdapterMode } from '../lib/env';
import type { CredentialAuditEntry, FuneralDirectorAuthorization, FuneralDirectorCredentialRecord } from '../domain/staff/funeralDirectorCredentials';
import type { FuneralDirectorLicense } from '../types/staffProfile';
import { funeralDirectorCredentialFixtures } from './__mocks__/funeralDirectorCredentialFixtures';

/**
 * Funeral director credential storage (Gus Phase 5H.1, 2026-11).
 *
 * Live: the `funeralDirectorCredentials` Wix collection (created 2026-11-18,
 * ADMIN-only, ordinary index on organizationId + staffProfileId). Live reads
 * and writes stay OFF unless the deployment turns them on
 * (services/funeralDirectorCredentialSwitch.ts).
 *
 * - One record per organization + staff profile, enforced by a
 *   DETERMINISTIC item id (credentialRecordId). Wix refuses a second insert
 *   with the same id (HTTP 409) — so two administrators creating the same
 *   person's first record can't both succeed. (Wix unique indexes are
 *   single-field only, so a compound unique index is not possible.)
 * - Every later write is a conditional PATCH on the read `revision` (plus
 *   organizationId and staffProfileId): Wix refuses a stale patch whole
 *   (HTTP 428/412) and applies none of its fields.
 * - The credential fields and the appended history entry are set in that
 *   ONE patch, so they are saved together or not at all.
 * - When Wix's answer is unclear, the record is read back and the new
 *   history entry's event id decides — never a blind retry.
 * - A read is always re-checked against the organization and staff profile
 *   asked for, never trusted from the backend filter alone.
 */
import { funeralDirectorCredentialsLive } from './funeralDirectorCredentialSwitch';
export const FUNERAL_DIRECTOR_CREDENTIALS_COLLECTION = 'funeralDirectorCredentials';

const ID_PART = /^[A-Za-z0-9-]+$/;
const WIX_ITEM_ID_MAX = 128;

/** `fdc.{organizationId}.{staffProfileId}` (Phase 5I). "." is used — not
    ":" — because "." already appears in live item ids on this Wix site
    (e.g. `rolePermissions`, `notifications`) while ":" has no live
    precedent and Wix documents only the 128-character limit. Each part may
    hold only letters, digits and hyphens, so "." can never appear inside a
    part and two different pairs can never produce the same id. The parts
    always come from server-side records (the caller's authorized
    organization and a staff profile verified to belong to it). */
export function credentialRecordId(organizationId: string, staffProfileId: string): string {
  if (!ID_PART.test(organizationId) || !ID_PART.test(staffProfileId)) {
    throw new Error('Organization and staff profile ids may contain only letters, digits and hyphens.');
  }
  const id = `fdc.${organizationId}.${staffProfileId}`;
  if (id.length > WIX_ITEM_ID_MAX) throw new Error(`Credential record id is longer than ${WIX_ITEM_ID_MAX} characters.`);
  return id;
}

export type WixCredentialItem = {
  organizationId?: unknown;
  staffProfileId?: unknown;
  identityId?: unknown;
  license?: unknown;
  authorization?: unknown;
  history?: unknown;
  revision?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Maps a stored item, or null when it does not belong to the pair asked
    for, or cannot be read. History is kept exactly as stored. */
export function mapWixCredentialItem(id: string, item: WixCredentialItem, expected: { organizationId: string; staffProfileId: string }): FuneralDirectorCredentialRecord | null {
  if (id !== credentialRecordId(expected.organizationId, expected.staffProfileId)) return null;
  if (item.organizationId !== expected.organizationId || item.staffProfileId !== expected.staffProfileId) return null;
  if (typeof item.identityId !== 'string' || typeof item.revision !== 'number' || !Array.isArray(item.history)) return null;
  if (!item.history.every((e) => isObject(e) && typeof e.eventId === 'string')) return null;
  return {
    organizationId: expected.organizationId,
    staffProfileId: expected.staffProfileId,
    identityId: item.identityId,
    license: isObject(item.license) ? (item.license as FuneralDirectorLicense) : null,
    authorization: isObject(item.authorization) ? (item.authorization as FuneralDirectorAuthorization) : null,
    revision: item.revision,
    history: item.history as CredentialAuditEntry[],
  };
}

export type CredentialWriteResult = { result: 'applied'; record: FuneralDirectorCredentialRecord } | { result: 'conflict' } | { result: 'not_saved' } | { result: 'unclear' };

export class CredentialStorageUnreadableError extends Error {}

export async function readCredentialRecord(organizationId: string, staffProfileId: string, mode: DataAdapterMode): Promise<FuneralDirectorCredentialRecord | null> {
  if (mode === 'mock') {
    const found = funeralDirectorCredentialFixtures.find((r) => r.organizationId === organizationId && r.staffProfileId === staffProfileId);
    return found ? structuredClone(found) : null;
  }
  if (!funeralDirectorCredentialsLive()) return null;
  const response = await queryWixDataItems<WixCredentialItem>(FUNERAL_DIRECTOR_CREDENTIALS_COLLECTION, { filter: { organizationId, staffProfileId }, paging: { limit: 2 } });
  const id = credentialRecordId(organizationId, staffProfileId);
  const item = response.dataItems.find((i) => i.id === id);
  if (!item) return null;
  const record = mapWixCredentialItem(item.id, item.data, { organizationId, staffProfileId });
  // A stored record that can't be read is never treated as "none" — that
  // would let the next save start over and lose its history.
  if (!record) throw new CredentialStorageUnreadableError('This staff member’s stored credentials could not be read. Nothing was changed.');
  return record;
}

/** Saves `next` (already validated, with its new history entry) over
    `current`, which is what the administrator's change was decided from. */
export async function writeCredentialRecord(current: FuneralDirectorCredentialRecord, next: FuneralDirectorCredentialRecord, mode: DataAdapterMode, now: string): Promise<CredentialWriteResult> {
  if (mode === 'mock') {
    const index = funeralDirectorCredentialFixtures.findIndex((r) => r.organizationId === current.organizationId && r.staffProfileId === current.staffProfileId);
    const stored = index === -1 ? null : funeralDirectorCredentialFixtures[index];
    if ((stored?.revision ?? 0) !== current.revision) return { result: 'conflict' };
    if (index === -1) funeralDirectorCredentialFixtures.push(structuredClone(next));
    else funeralDirectorCredentialFixtures[index] = structuredClone(next);
    return { result: 'applied', record: structuredClone(next) };
  }
  if (!funeralDirectorCredentialsLive()) return { result: 'not_saved' };

  const id = credentialRecordId(next.organizationId, next.staffProfileId);
  const eventId = next.history[next.history.length - 1]?.eventId;
  const fields = { license: next.license, authorization: next.authorization, history: next.history, revision: next.revision, updatedAt: now };
  try {
    if (current.revision === 0) {
      await insertWixDataItem<WixCredentialItem>(
        FUNERAL_DIRECTOR_CREDENTIALS_COLLECTION,
        { organizationId: next.organizationId, staffProfileId: next.staffProfileId, identityId: next.identityId, ...fields, createdAt: now },
        id,
      );
      return { result: 'applied', record: next };
    }
    const response = await conditionalPatchWixDataItemFields<WixCredentialItem>(FUNERAL_DIRECTOR_CREDENTIALS_COLLECTION, id, fields, {
      filter: { revision: current.revision, organizationId: current.organizationId, staffProfileId: current.staffProfileId },
    });
    if (response.applied) return { result: 'applied', record: next };
    if (response.status === 428 || response.status === 412) return { result: 'conflict' };
  } catch (error) {
    // Another administrator created this person's record first.
    if (error instanceof WixDataApiError && error.status === 409) return { result: 'conflict' };
  }
  // Unclear: read back; the new history entry decides.
  try {
    const stored = await readCredentialRecord(next.organizationId, next.staffProfileId, mode);
    if (stored && stored.revision === next.revision && stored.history[stored.history.length - 1]?.eventId === eventId) return { result: 'applied', record: stored };
    return { result: 'not_saved' };
  } catch {
    return { result: 'unclear' };
  }
}
