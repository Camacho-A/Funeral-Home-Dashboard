import type { DataAdapterMode } from '../lib/env';
import { generateTotpSecret, verifyTotpCode } from '../lib/identity/totp';
import { encryptTotpSecret, tryDecryptTotpSecret } from '../lib/identity/mfaSecretEncryption';
import { hashToken } from '../lib/identity/tokens';
import { randomBytes } from 'crypto';
import { getIdentityById, getIdentitySecrets, updateIdentitySecrets, updateIdentity } from './identityService';
import { isPortalScopedMfa, portalMfaScopeId } from '../lib/identity/portalMfaScope';
import { deletePortalEnrollment, getPortalEnrollment, savePortalEnrollment } from './portalMfaStore';
import type { Identity } from '../types/identity';

/**
 * Phase 21 (Identity, Authentication & Session Management). TOTP-based
 * MFA — "Implement architecture now... MFA may remain optional in v1."
 * The secret is never stored in plaintext (`mfaSecretReference` holds an
 * AES-256-GCM-encrypted value — see `lib/identity/mfaSecretEncryption.ts`'s
 * own comment on why "reference" means "encrypted," not "env-var name,"
 * here); recovery codes are generated once and only their hashes are
 * ever stored.
 */
const RECOVERY_CODE_COUNT = 10;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Portal-scoped MFA (Phase 5N follow-up, 2026-11). Where an enrollment
 * lives: the shared identity record (the original fields, owned by the
 * deployment that created them — Manors Production), or, on a
 * portal-scoped deployment (lib/identity/portalMfaScope.ts), this
 * portal's own store. Every function below works the same way on either;
 * a portal-scoped deployment never reads or writes the shared fields.
 */
type Enrollment = { secretReference: string | null; verifiedAt: string | null; recoveryCodeHashes: string[]; enabled: boolean };
type EnrollmentPatch = Partial<Omit<Enrollment, 'enabled'>> & { enabled?: boolean };

async function readEnrollment(identityId: string, mode: DataAdapterMode): Promise<Enrollment | null> {
  if (isPortalScopedMfa()) {
    const e = await getPortalEnrollment(portalMfaScopeId(), identityId, mode);
    return e ? { secretReference: e.secretReference, verifiedAt: e.verifiedAt, recoveryCodeHashes: e.recoveryCodeHashes, enabled: e.verifiedAt !== null } : null;
  }
  const [secrets, identity] = await Promise.all([getIdentitySecrets(identityId, mode), getIdentityById(identityId, mode)]);
  if (!secrets) return null;
  return { secretReference: secrets.mfaSecretReference, verifiedAt: secrets.mfaVerifiedAt, recoveryCodeHashes: secrets.mfaRecoveryCodeHashes, enabled: identity?.mfaEnabled === true };
}

async function writeEnrollment(identityId: string, patch: EnrollmentPatch, mode: DataAdapterMode): Promise<void> {
  if (isPortalScopedMfa()) {
    const scopeId = portalMfaScopeId();
    const current = await getPortalEnrollment(scopeId, identityId, mode);
    const now = nowIso();
    const next = {
      scopeId,
      identityId,
      secretReference: patch.secretReference !== undefined ? patch.secretReference : current?.secretReference ?? null,
      verifiedAt: patch.verifiedAt !== undefined ? patch.verifiedAt : current?.verifiedAt ?? null,
      recoveryCodeHashes: patch.recoveryCodeHashes ?? current?.recoveryCodeHashes ?? [],
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    await savePortalEnrollment(next, mode);
    return;
  }
  const secretsPatch: Parameters<typeof updateIdentitySecrets>[1] = {};
  if (patch.secretReference !== undefined) secretsPatch.mfaSecretReference = patch.secretReference;
  if (patch.verifiedAt !== undefined) secretsPatch.mfaVerifiedAt = patch.verifiedAt;
  if (patch.recoveryCodeHashes !== undefined) secretsPatch.mfaRecoveryCodeHashes = patch.recoveryCodeHashes;
  if (Object.keys(secretsPatch).length > 0) await updateIdentitySecrets(identityId, secretsPatch, mode);
  if (patch.enabled !== undefined) await updateIdentity(identityId, { mfaEnabled: patch.enabled }, mode);
}

export type MfaState = {
  /** This deployment keeps its own enrollments (portal-scoped). */
  portalScoped: boolean;
  /** MFA is enabled in THIS portal — sign-in requires a code checked here. */
  enabled: boolean;
  /** Portal-scoped only: MFA was set up through another SOLIS deployment
      (the original fields) and not yet here. Such a person may never sign
      in here with a password alone: they need an administrator-issued
      one-time setup code, then enroll here (their other enrollment is
      untouched). */
  enrolledElsewhere: boolean;
};

export async function getMfaState(identity: Pick<Identity, 'id' | 'mfaEnabled'>, mode: DataAdapterMode): Promise<MfaState> {
  if (!isPortalScopedMfa()) return { portalScoped: false, enabled: identity.mfaEnabled, enrolledElsewhere: false };
  const e = await getPortalEnrollment(portalMfaScopeId(), identity.id, mode);
  const enabled = Boolean(e?.verifiedAt);
  return { portalScoped: true, enabled, enrolledElsewhere: identity.mfaEnabled && !enabled };
}

/** Step 1 of enrollment: generates a fresh secret, encrypts and stores it,
    but does *not* enable MFA yet — enabling requires proving the user's
    authenticator app actually has it (see verifyMfaEnrollment). Returns
    the plaintext secret once, for rendering as a QR code / manual entry
    key; never persisted in plaintext anywhere. Portal-scoped: written to
    this portal's store only. */
export async function beginMfaEnrollment(identityId: string, dataAdapterMode: DataAdapterMode): Promise<{ secret: string }> {
  const secret = generateTotpSecret();
  await writeEnrollment(identityId, { secretReference: encryptTotpSecret(secret) }, dataAdapterMode);
  return { secret };
}

function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    // Short, human-typeable recovery codes (10 hex chars from 5 random
    // bytes) — 40 bits of entropy each; only their hashes are stored.
    const code = randomBytes(5).toString('hex');
    codes.push(code);
    hashes.push(hashToken(code));
  }
  return { codes, hashes };
}

/** Step 2: proves possession of the enrolled secret, enables MFA, and
    generates recovery codes — "Generate once." Disabling and re-enrolling
    is the reset path. */
export async function verifyMfaEnrollment(
  identityId: string,
  code: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ success: boolean; recoveryCodes?: string[] }> {
  const enrollment = await readEnrollment(identityId, dataAdapterMode);
  if (!enrollment?.secretReference) return { success: false };
  const plainSecret = tryDecryptTotpSecret(enrollment.secretReference);
  if (plainSecret === null || !verifyTotpCode(plainSecret, code)) return { success: false };
  const { codes, hashes } = newRecoveryCodes();
  await writeEnrollment(identityId, { verifiedAt: nowIso(), recoveryCodeHashes: hashes, enabled: true }, dataAdapterMode);
  return { success: true, recoveryCodes: codes };
}

export async function verifyMfaCode(identityId: string, code: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const enrollment = await readEnrollment(identityId, dataAdapterMode);
  if (!enrollment?.secretReference) return false;
  const secret = tryDecryptTotpSecret(enrollment.secretReference);
  return secret !== null && verifyTotpCode(secret, code);
}

/** False when this identity's enrollment here cannot be checked by this
    deployment (enrolled under another deployment's key, legacy mode only).
    Recovery codes (stored as hashes) still work there. */
export async function isMfaSecretReadableHere(identityId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const enrollment = await readEnrollment(identityId, dataAdapterMode);
  return Boolean(enrollment?.secretReference) && tryDecryptTotpSecret(enrollment!.secretReference!) !== null;
}

/** Single-use — a matched recovery code is removed from the stored list so
    it can never be replayed. Portal-scoped: only this portal's codes. */
export async function verifyAndConsumeRecoveryCode(identityId: string, code: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const enrollment = await readEnrollment(identityId, dataAdapterMode);
  if (!enrollment) return false;
  const matchIndex = enrollment.recoveryCodeHashes.indexOf(hashToken(code));
  if (matchIndex === -1) return false;
  const remaining = [...enrollment.recoveryCodeHashes];
  remaining.splice(matchIndex, 1);
  await writeEnrollment(identityId, { recoveryCodeHashes: remaining }, dataAdapterMode);
  return true;
}

/** Replaces the recovery codes (old ones stop working). Requires a valid
    current code as proof of possession. Returns the new codes once. */
export async function regenerateRecoveryCodes(
  identityId: string,
  code: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ success: boolean; recoveryCodes?: string[] }> {
  if (!(await verifyMfaCode(identityId, code, dataAdapterMode))) return { success: false };
  const { codes, hashes } = newRecoveryCodes();
  await writeEnrollment(identityId, { recoveryCodeHashes: hashes }, dataAdapterMode);
  return { success: true, recoveryCodes: codes };
}

/** How many unused recovery codes remain. Never returns the codes. */
export async function countRemainingRecoveryCodes(identityId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  return (await readEnrollment(identityId, dataAdapterMode))?.recoveryCodeHashes.length ?? 0;
}

/** Turns MFA off for this deployment's enrollment. Portal-scoped: removes
    only this portal's enrollment; the shared record is never touched. */
export async function disableMfa(identityId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (isPortalScopedMfa()) {
    await deletePortalEnrollment(portalMfaScopeId(), identityId, dataAdapterMode);
    return;
  }
  await writeEnrollment(identityId, { secretReference: null, verifiedAt: null, recoveryCodeHashes: [], enabled: false }, dataAdapterMode);
}
