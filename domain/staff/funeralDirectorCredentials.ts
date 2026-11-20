import type { FuneralDirectorLicense, FuneralDirectorLicenseStatus, StaffProfile } from '../../types/staffProfile';

/**
 * Funeral director credentials (Gus Phase 5G, 2026-11) — one record per
 * staff profile: the license, how it was verified, and any separate
 * Funeral Director authorization, with an append-only audit history.
 *
 * Rules:
 * - Nobody changes their OWN credentials: no self-entry, self-verification
 *   or self-authorization (an administrator included).
 * - Changing the license details clears its verification — it must be
 *   verified again, by someone else.
 * - Every change appends one history entry (what, before, after, who,
 *   when, why) in the same write as the change; nothing is ever removed.
 * - `revision` makes each write conditional on what the administrator saw,
 *   so two administrators can't silently overwrite each other.
 *
 * Holding a verified license or an authorization never permits release on
 * its own — release has its own full set of prerequisites
 * (domain/servicePreparation/releaseForCremation.ts).
 */
export type FuneralDirectorAuthorization = NonNullable<StaffProfile['funeralDirectorAuthorization']>;

export type CredentialAuditEntry = {
  eventId: string;
  action: 'license_set' | 'license_verified' | 'authorization_granted' | 'authorization_revoked';
  reason: string | null;
  before: { license: FuneralDirectorLicense | null; authorization: FuneralDirectorAuthorization | null };
  after: { license: FuneralDirectorLicense | null; authorization: FuneralDirectorAuthorization | null };
  actorId: string;
  actorName: string | null;
  at: string;
};

export type FuneralDirectorCredentialRecord = {
  organizationId: string;
  staffProfileId: string;
  /** The licensee's identity — used to refuse self-service. */
  identityId: string;
  license: FuneralDirectorLicense | null;
  authorization: FuneralDirectorAuthorization | null;
  revision: number;
  history: CredentialAuditEntry[];
};

export const LICENSE_TYPES = [
  { value: 'funeral_director', label: 'Funeral director' },
  { value: 'funeral_director_and_embalmer', label: 'Funeral director and embalmer' },
  { value: 'direct_disposer', label: 'Direct disposer' },
] as const;
export const LICENSE_STATUSES: readonly FuneralDirectorLicenseStatus[] = ['active', 'inactive', 'expired', 'suspended', 'revoked', 'unknown'];
export const VERIFICATION_METHODS = [
  { value: 'state_license_lookup', label: 'State license lookup' },
  { value: 'license_document', label: 'License document' },
] as const;

export type CredentialChange =
  | { kind: 'set_license'; licenseNumber: string; state: string; licenseType: string; status: FuneralDirectorLicenseStatus; expiresOn: string }
  | { kind: 'verify_license'; method: 'state_license_lookup' | 'license_document'; reference: string }
  | { kind: 'grant_authorization' }
  | { kind: 'revoke_authorization'; reason: string };

export class CredentialChangeError extends Error {}
/** The record (with its history) would be too large to save safely. */
export class CredentialRecordLimitError extends CredentialChangeError {}

/** Well under Wix's 512 KB item limit. A record grows by a few hundred
    bytes per change; history is never trimmed — a change past this is
    refused instead (Phase 5H.1). */
export const CREDENTIAL_RECORD_MAX_BYTES = 128 * 1024;
export const credentialRecordBytes = (record: unknown) => new TextEncoder().encode(JSON.stringify(record)).length;
/** Someone tried to change, verify or authorize their own credentials. */
export class SelfServiceCredentialError extends CredentialChangeError {}

const TEXT_MAX = 200;
const clean = (value: string | null | undefined) => (value?.trim() ? value.trim().slice(0, TEXT_MAX) : '');

export function emptyCredentialRecord(staff: Pick<StaffProfile, 'id' | 'organizationId' | 'identityId'>): FuneralDirectorCredentialRecord {
  return { organizationId: staff.organizationId, staffProfileId: staff.id, identityId: staff.identityId, license: null, authorization: null, revision: 0, history: [] };
}

export function applyCredentialChange(params: {
  record: FuneralDirectorCredentialRecord;
  change: CredentialChange;
  actor: { id: string; name: string | null };
  now: string;
  eventId: string;
}): FuneralDirectorCredentialRecord {
  const { record, change, actor, now } = params;
  if (actor.id === record.identityId) {
    throw new SelfServiceCredentialError('You cannot change, verify or authorize your own funeral director credentials. Someone else who manages credentials must do it.');
  }
  const before = { license: record.license, authorization: record.authorization };
  let license = record.license;
  let authorization = record.authorization;
  let reason: string | null = null;
  let action: CredentialAuditEntry['action'];

  if (change.kind === 'set_license') {
    const licenseNumber = clean(change.licenseNumber);
    const state = clean(change.state).toUpperCase();
    if (!licenseNumber) throw new CredentialChangeError('Enter the license number.');
    if (!/^[A-Z]{2}$/.test(state)) throw new CredentialChangeError('Enter the two-letter state.');
    if (!LICENSE_TYPES.some((t) => t.value === change.licenseType)) throw new CredentialChangeError('Choose the license type.');
    if (!LICENSE_STATUSES.includes(change.status)) throw new CredentialChangeError('Choose the license status.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change.expiresOn) || Number.isNaN(Date.parse(`${change.expiresOn}T00:00:00Z`))) throw new CredentialChangeError('Enter the expiration date.');
    // New or changed details are not verified until someone checks them.
    license = { licenseNumber, state, licenseType: change.licenseType, status: change.status, expiresOn: change.expiresOn, verification: null };
    action = 'license_set';
  } else if (change.kind === 'verify_license') {
    if (!license) throw new CredentialChangeError('Enter the license details before verifying them.');
    if (!VERIFICATION_METHODS.some((m) => m.value === change.method)) throw new CredentialChangeError('Choose how the license was verified.');
    const reference = clean(change.reference);
    if (!reference) throw new CredentialChangeError('Enter where the license was verified (lookup page, document).');
    license = { ...license, verification: { verifiedAt: now, verifiedBy: actor.id, verifiedByName: actor.name, method: change.method, reference } };
    action = 'license_verified';
  } else if (change.kind === 'grant_authorization') {
    if (authorization) throw new CredentialChangeError('Already authorized as a Funeral Director.');
    authorization = { authorizedAt: now, authorizedBy: actor.id, authorizedByName: actor.name };
    action = 'authorization_granted';
  } else {
    if (!authorization) throw new CredentialChangeError('Not authorized as a Funeral Director.');
    reason = clean(change.reason);
    if (!reason) throw new CredentialChangeError('Give a reason for removing the authorization.');
    authorization = null;
    action = 'authorization_revoked';
  }

  const entry: CredentialAuditEntry = { eventId: params.eventId, action, reason, before, after: { license, authorization }, actorId: actor.id, actorName: actor.name, at: now };
  const next = { ...record, license, authorization, revision: record.revision + 1, history: [...record.history, entry] };
  if (credentialRecordBytes(next) > CREDENTIAL_RECORD_MAX_BYTES) {
    throw new CredentialRecordLimitError('This staff member’s credential record is full (including its history). Nothing was saved. Please contact SolisCode support.');
  }
  return next;
}

export const CREDENTIAL_ACTION_LABEL: Record<CredentialAuditEntry['action'], string> = {
  license_set: 'License details entered',
  license_verified: 'License verified',
  authorization_granted: 'Funeral Director authorization granted',
  authorization_revoked: 'Funeral Director authorization removed',
};
