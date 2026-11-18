import crypto from 'crypto';
import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { checkFuneralDirectorLicense, type LicenseCheck } from '../domain/staff/funeralDirectorLicense';
import {
  applyCredentialChange,
  CREDENTIAL_ACTION_LABEL,
  CredentialChangeError,
  SelfServiceCredentialError,
  emptyCredentialRecord,
  type CredentialChange,
  type FuneralDirectorCredentialRecord,
} from '../domain/staff/funeralDirectorCredentials';
import type { DataAdapterMode } from '../lib/env';
import type { StaffProfile } from '../types/staffProfile';
import { recordFuneralDirectorCredentialChange, type ActivityContext } from './activityService';
import { funeralDirectorCredentialFixtures } from './__mocks__/funeralDirectorCredentialFixtures';
import { getById as getStaffProfile, list as listStaffProfiles } from './staffProfileService';

/**
 * Funeral director credentials (Gus Phase 5G, 2026-11) — the one reader
 * and writer. Organization-scoped throughout; only for an organization
 * with `funeralDirectorCredentials` (Gus).
 *
 * SANDBOX ONLY. There is no live store yet: the proposed `funeralDirector
 * Credentials` Wix collection (docs/SERVICE_PREPARATION.md) does not exist,
 * so in Wix mode reads find no credentials (nobody is verified) and writes
 * are refused before anything reaches Wix.
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
  if (mode !== 'mock' || !enabled(organizationId)) return null;
  const found = funeralDirectorCredentialFixtures.find((r) => r.organizationId === organizationId && r.staffProfileId === staffProfileId);
  return found ? structuredClone(found) : null;
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
  if (mode !== 'mock') throw new CredentialServiceError(CREDENTIAL_STORAGE_UNAVAILABLE, 503);
  const staff = await getStaffProfile(organizationId, input.staffProfileId, mode);
  if (!staff) throw new CredentialServiceError('Staff member not found.', 404);

  const index = funeralDirectorCredentialFixtures.findIndex((r) => r.organizationId === organizationId && r.staffProfileId === staff.id);
  const current = index === -1 ? emptyCredentialRecord(staff) : funeralDirectorCredentialFixtures[index];
  if (current.revision !== input.expectedRevision) {
    throw new CredentialServiceError('Someone else changed these credentials while you were working. The latest is shown — please check and try again.', 409);
  }
  const eventId = crypto.randomUUID();
  let next: FuneralDirectorCredentialRecord;
  try {
    next = applyCredentialChange({ record: current, change: input.change, actor: { id: ctx.actorIdentityId, name: input.actorName }, now: input.now ?? new Date().toISOString(), eventId });
  } catch (error) {
    if (error instanceof CredentialChangeError) throw new CredentialServiceError(error.message, error instanceof SelfServiceCredentialError ? 403 : 400);
    throw error;
  }
  if (index === -1) funeralDirectorCredentialFixtures.push(next);
  else funeralDirectorCredentialFixtures[index] = next;

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
