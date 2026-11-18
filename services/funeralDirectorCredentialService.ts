import crypto from 'crypto';
import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { checkFuneralDirectorLicense, type LicenseCheck } from '../domain/staff/funeralDirectorLicense';
import {
  applyCredentialChange,
  CREDENTIAL_ACTION_LABEL,
  CredentialChangeError,
  CredentialRecordLimitError,
  SelfServiceCredentialError,
  emptyCredentialRecord,
  type CredentialChange,
  type FuneralDirectorCredentialRecord,
} from '../domain/staff/funeralDirectorCredentials';
import type { DataAdapterMode } from '../lib/env';
import type { StaffProfile } from '../types/staffProfile';
import { recordFuneralDirectorCredentialChange, type ActivityContext } from './activityService';
import { assertStaffProfileIsActiveAndInOrganization, list as listStaffProfiles } from './staffProfileService';
import { CredentialStorageUnreadableError, readCredentialRecord, writeCredentialRecord } from './funeralDirectorCredentialStore';
import { funeralDirectorCredentialsLive } from './funeralDirectorCredentialSwitch';

/**
 * Funeral director credentials (Gus Phase 5G, 2026-11) — the one reader
 * and writer. Organization-scoped throughout; only for an organization
 * with `funeralDirectorCredentials` (Gus).
 *
 * Storage: services/funeralDirectorCredentialStore.ts. The live Wix
 * collection exists (2026-11-18); live reads and writes happen only in a
 * deployment that sets SOLIS_FD_CREDENTIALS_STORAGE=wix
 * (services/funeralDirectorCredentialSwitch.ts). Elsewhere in Wix mode
 * nobody is verified and changes are refused before anything reaches Wix.
 *
 * The person whose credentials change is established on the server: an
 * ACTIVE staff profile in the caller's organization with an active
 * membership (assertStaffProfileIsActiveAndInOrganization). The browser
 * names the staff profile; it never supplies the organization, the
 * licensee identity or the record id.
 */
export class CredentialServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const CREDENTIAL_STORAGE_UNAVAILABLE = 'Funeral director credentials cannot be saved on this site yet: their storage has not been added. Nothing was saved.';

function enabled(organizationId: string): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.funeralDirectorCredentials;
}

/** The credential record for one staff profile, or null. Never another organization's. */
export async function getCredentialRecord(organizationId: string, staffProfileId: string, mode: DataAdapterMode): Promise<FuneralDirectorCredentialRecord | null> {
  if (!enabled(organizationId)) return null;
  try {
    return await readCredentialRecord(organizationId, staffProfileId, mode);
  } catch (error) {
    // Unreadable → treated as no credentials for the release check (fails
    // closed); changes are refused separately in changeCredentials.
    if (error instanceof CredentialStorageUnreadableError) return null;
    throw error;
  }
}

/** A staff profile with its credentials attached, for the release check. */
export async function withCredentials<T extends Pick<StaffProfile, 'id' | 'organizationId'>>(staff: T, mode: DataAdapterMode): Promise<T & Pick<StaffProfile, 'funeralDirectorLicense' | 'funeralDirectorAuthorization'>> {
  const record = await getCredentialRecord(staff.organizationId, staff.id, mode);
  return { ...staff, funeralDirectorLicense: record?.license ?? null, funeralDirectorAuthorization: record?.authorization ?? null };
}

export type StaffCredentialSummary = {
  staffProfileId: string;
  identityId: string;
  displayName: string;
  isActive: boolean;
  record: FuneralDirectorCredentialRecord | null;
  licenseCheck: LicenseCheck;
};

export async function listCredentialSummaries(organizationId: string, mode: DataAdapterMode, now = new Date().toISOString()): Promise<StaffCredentialSummary[]> {
  if (!enabled(organizationId)) throw new CredentialServiceError('Funeral director credentials are not used by this funeral home.', 404);
  const reverify = getRegisteredOrganizationProfile(organizationId).features.funeralDirectorLicenseReverifyDays;
  const staff = await listStaffProfiles(organizationId, mode);
  return Promise.all(
    staff.map(async (s) => {
      const record = await getCredentialRecord(organizationId, s.id, mode);
      return {
        staffProfileId: s.id,
        identityId: s.identityId,
        displayName: s.displayName,
        isActive: s.isActive,
        record,
        licenseCheck: checkFuneralDirectorLicense({ ...s, funeralDirectorLicense: record?.license ?? null }, { organizationId, today: now.slice(0, 10), now, reverifyWithinDays: reverify }),
      };
    }),
  );
}

export async function changeCredentials(
  ctx: ActivityContext,
  input: { staffProfileId: string; change: CredentialChange; expectedRevision: number; actorName: string | null; now?: string },
  mode: DataAdapterMode,
): Promise<FuneralDirectorCredentialRecord> {
  const { organizationId } = ctx;
  if (!enabled(organizationId)) throw new CredentialServiceError('Funeral director credentials are not used by this funeral home.', 404);
  if (!ctx.actorIdentityId) throw new CredentialServiceError('Sign in to change credentials.', 403);
  if (mode !== 'mock' && !funeralDirectorCredentialsLive()) throw new CredentialServiceError(CREDENTIAL_STORAGE_UNAVAILABLE, 503);
  let staff;
  try {
    staff = await assertStaffProfileIsActiveAndInOrganization(organizationId, input.staffProfileId, mode);
  } catch {
    throw new CredentialServiceError('That person is not an active staff member of this funeral home.', 404);
  }

  let current: FuneralDirectorCredentialRecord;
  try {
    current = (await readCredentialRecord(organizationId, staff.id, mode)) ?? emptyCredentialRecord(staff);
  } catch (error) {
    if (error instanceof CredentialStorageUnreadableError) throw new CredentialServiceError(error.message, 409);
    throw error;
  }
  if (current.revision !== input.expectedRevision) {
    throw new CredentialServiceError('Someone else changed these credentials while you were working. The latest is shown — please check and try again.', 409);
  }
  const now = input.now ?? new Date().toISOString();
  const eventId = crypto.randomUUID();
  let next: FuneralDirectorCredentialRecord;
  try {
    next = applyCredentialChange({ record: current, change: input.change, actor: { id: ctx.actorIdentityId, name: input.actorName }, now, eventId });
  } catch (error) {
    if (error instanceof CredentialRecordLimitError) throw new CredentialServiceError(error.message, 413);
    if (error instanceof CredentialChangeError) throw new CredentialServiceError(error.message, error instanceof SelfServiceCredentialError ? 403 : 400);
    throw error;
  }
  const written = await writeCredentialRecord(current, next, mode, now);
  if (written.result === 'conflict') throw new CredentialServiceError('Someone else changed these credentials while you were working. The latest is shown — please check and try again.', 409);
  if (written.result === 'not_saved') throw new CredentialServiceError('This change was not saved. Please try again.', 503);
  if (written.result === 'unclear') throw new CredentialServiceError('SOLIS could not confirm whether this change was saved. Refresh the page and check before trying again.', 503);
  next = written.record;

  const entry = next.history[next.history.length - 1];
  try {
    await recordFuneralDirectorCredentialChange(
      { ...ctx, correlationId: eventId },
      staff.id,
      { description: `${CREDENTIAL_ACTION_LABEL[entry.action]} — ${staff.displayName}`, previous: entry.before, next: entry.after },
      mode,
    );
  } catch (error) {
    console.error(`Activity event for credential change ${eventId} was not recorded; the change and its history entry are saved:`, error instanceof Error ? error.message : error);
  }
  return structuredClone(next);
}
