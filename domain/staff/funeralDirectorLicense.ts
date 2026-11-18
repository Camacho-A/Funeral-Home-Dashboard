import type { FuneralDirectorLicense, StaffProfile } from '../../types/staffProfile';

/**
 * Is this staff member a VERIFIED funeral director today? (Gus Phase 5F,
 * 2026-11.) A role called "Funeral Director" — or a display role of
 * funeral_director — proves nothing; only a license record that passes
 * every check below does.
 *
 * - a license number, state and type on file;
 * - status `active`, not expired (expiry date on or after today);
 * - verified against the state's record (or the license itself) by
 *   SOMEONE ELSE, recorded with who, when, how and where;
 * - re-verified within the organization's interval
 *   (`funeralDirectorLicenseReverifyDays`) — a configuration DECISION
 *   still pending: PROPOSED_LICENSE_REVERIFY_DAYS is only a proposal. While
 *   no interval is set, age is not enforced and the check says so in
 *   `notes`;
 * - the staff profile is active and belongs to the organization asking.
 */
/** A proposal for the re-verification interval, NOT an approved policy. */
export const PROPOSED_LICENSE_REVERIFY_DAYS = 365;

export type LicenseCheck = { verified: boolean; problems: string[]; notes: string[] };

const DAY = 24 * 60 * 60 * 1000;

export function checkFuneralDirectorLicense(
  staff: Pick<StaffProfile, 'identityId' | 'organizationId' | 'isActive'> & { funeralDirectorLicense?: FuneralDirectorLicense | null },
  params: { organizationId: string; today: string; now: string; reverifyWithinDays: number | null },
): LicenseCheck {
  const problems: string[] = [];
  const license = staff.funeralDirectorLicense;
  if (staff.organizationId !== params.organizationId) problems.push('Staff member belongs to another organization.');
  if (!staff.isActive) problems.push('Staff profile is inactive.');
  const notes: string[] = [];
  if (!license) return { verified: false, problems: [...problems, 'No funeral director license on file.'], notes };
  if (!license.licenseNumber.trim() || !license.state.trim() || !license.licenseType.trim()) problems.push('License number, state or type missing.');
  if (license.status !== 'active') problems.push(`License status is ${license.status}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(license.expiresOn)) problems.push('License expiration date missing or invalid.');
  else if (license.expiresOn < params.today) problems.push(`License expired on ${license.expiresOn}.`);
  const v = license.verification;
  if (!v) problems.push('License has not been verified.');
  else {
    if (!v.verifiedBy || !v.reference.trim() || Number.isNaN(Date.parse(v.verifiedAt))) problems.push('License verification is incomplete.');
    if (v.verifiedBy === staff.identityId) problems.push('A license must be verified by someone other than the licensee.');
    if (params.reverifyWithinDays === null) notes.push('No re-verification interval is set yet (pending approval).');
    else if (Date.parse(params.now) - Date.parse(v.verifiedAt) > params.reverifyWithinDays * DAY) problems.push(`License was last verified more than ${params.reverifyWithinDays} days ago.`);
  }
  return { verified: problems.length === 0, problems, notes };
}
