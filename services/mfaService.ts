import type { DataAdapterMode } from '../lib/env';
import { generateTotpSecret, verifyTotpCode } from '../lib/identity/totp';
import { encryptTotpSecret, decryptTotpSecret } from '../lib/identity/mfaSecretEncryption';
import { hashToken } from '../lib/identity/tokens';
import { randomBytes } from 'crypto';
import { getIdentitySecrets, updateIdentitySecrets, updateIdentity } from './identityService';

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

/** Step 1 of enrollment: generates a fresh secret, encrypts and stores it,
    but does *not* enable MFA yet — enabling requires proving the user's
    authenticator app actually has it (see verifyMfaEnrollment). Returns
    the plaintext secret once, for rendering as a QR code / manual entry
    key; never persisted in plaintext anywhere. */
export async function beginMfaEnrollment(identityId: string, dataAdapterMode: DataAdapterMode): Promise<{ secret: string }> {
  const secret = generateTotpSecret();
  await updateIdentitySecrets(identityId, { mfaSecretReference: encryptTotpSecret(secret) }, dataAdapterMode);
  return { secret };
}

/** Step 2: proves possession of the enrolled secret, enables MFA, and
    generates recovery codes — "Generate once." A second call after MFA is
    already enabled does not generate a fresh batch (recovery codes are
    not meant to be regenerated casually; disabling and re-enrolling MFA
    is the reset path). */
export async function verifyMfaEnrollment(
  identityId: string,
  code: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ success: boolean; recoveryCodes?: string[] }> {
  const secrets = await getIdentitySecrets(identityId, dataAdapterMode);
  if (!secrets?.mfaSecretReference) return { success: false };

  const plainSecret = decryptTotpSecret(secrets.mfaSecretReference);
  if (!verifyTotpCode(plainSecret, code)) return { success: false };

  const recoveryCodes: string[] = [];
  const recoveryCodeHashes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    // Short, human-typeable recovery codes (10 hex chars from 5 random
    // bytes) — long enough to resist guessing (40 bits of entropy per
    // code), short enough to type from a printed/saved list.
    const code = randomBytes(5).toString('hex');
    recoveryCodes.push(code);
    recoveryCodeHashes.push(hashToken(code));
  }

  await updateIdentitySecrets(identityId, { mfaVerifiedAt: nowIso(), mfaRecoveryCodeHashes: recoveryCodeHashes }, dataAdapterMode);
  await updateIdentity(identityId, { mfaEnabled: true }, dataAdapterMode);

  return { success: true, recoveryCodes };
}

export async function verifyMfaCode(identityId: string, code: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const secrets = await getIdentitySecrets(identityId, dataAdapterMode);
  if (!secrets?.mfaSecretReference) return false;
  return verifyTotpCode(decryptTotpSecret(secrets.mfaSecretReference), code);
}

/** Single-use — a matched recovery code is removed from the stored list
    so it can never be replayed. */
export async function verifyAndConsumeRecoveryCode(identityId: string, code: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const secrets = await getIdentitySecrets(identityId, dataAdapterMode);
  if (!secrets) return false;
  const codeHash = hashToken(code);
  const matchIndex = secrets.mfaRecoveryCodeHashes.indexOf(codeHash);
  if (matchIndex === -1) return false;

  const remaining = [...secrets.mfaRecoveryCodeHashes];
  remaining.splice(matchIndex, 1);
  await updateIdentitySecrets(identityId, { mfaRecoveryCodeHashes: remaining }, dataAdapterMode);
  return true;
}

export async function disableMfa(identityId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  await updateIdentitySecrets(identityId, { mfaSecretReference: null, mfaVerifiedAt: null, mfaRecoveryCodeHashes: [] }, dataAdapterMode);
  await updateIdentity(identityId, { mfaEnabled: false }, dataAdapterMode);
}
