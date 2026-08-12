import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import {
  mapWixIdentityItem,
  mapWixIdentitySecrets,
  buildWixIdentityData,
  applyIdentityUpdateToWixData,
  type WixIdentityItem,
} from '../lib/wixIdentityMapper';
import type { Identity, IdentitySecrets } from '../types/identity';
import { normalizeEmail } from '../domain/identity/email';
import { identityFixtures, type MockIdentityRecord } from './__mocks__/identityFixtures';

/**
 * Phase 21 (Identity, Authentication & Session Management). Owns the
 * `identities` Wix collection exclusively — every other identity-related
 * service (`passwordService.ts`, `mfaService.ts`) reads/writes secrets
 * through this module's `getIdentitySecrets`/`updateIdentitySecrets`
 * rather than touching `identities` directly, the same "one service owns
 * one collection" discipline `paymentsService.ts` established for
 * `paymentIntegrations`/`paymentRecords`.
 *
 * `Identity` answers "who is this person" only — see `types/identity.ts`'s
 * own comment. Nothing here ever resolves or grants organization
 * permissions; that's `services/membershipService.ts`'s job entirely.
 */

const WIX_CONFLICT_STATUS = 409;
function isWixConflict(error: unknown): boolean {
  return error instanceof WixDataApiError && error.status === WIX_CONFLICT_STATUS;
}

function nowIso(): string {
  return new Date().toISOString();
}

function splitMockRecord(record: MockIdentityRecord): { identity: Identity; secrets: IdentitySecrets } {
  const { passwordHash, mfaSecretReference, mfaVerifiedAt, mfaRecoveryCodeHashes, ...identity } = record;
  return { identity, secrets: { passwordHash, mfaSecretReference, mfaVerifiedAt, mfaRecoveryCodeHashes } };
}

export async function getIdentityById(identityId: string, dataAdapterMode: DataAdapterMode): Promise<Identity | null> {
  if (dataAdapterMode === 'mock') {
    const record = identityFixtures.find((i) => i.id === identityId);
    return record ? splitMockRecord(record).identity : null;
  }
  const response = await queryWixDataItems<WixIdentityItem>('identities', {
    filter: { beaconIdentityId: identityId },
    paging: { limit: 1 },
  });
  return mapWixIdentityItem(response.dataItems[0]?.data);
}

export async function findIdentityByEmail(email: string, dataAdapterMode: DataAdapterMode): Promise<Identity | null> {
  const normalizedEmail = normalizeEmail(email);
  if (dataAdapterMode === 'mock') {
    const record = identityFixtures.find((i) => i.normalizedEmail === normalizedEmail);
    return record ? splitMockRecord(record).identity : null;
  }
  const response = await queryWixDataItems<WixIdentityItem>('identities', {
    filter: { normalizedEmail },
    paging: { limit: 1 },
  });
  return mapWixIdentityItem(response.dataItems[0]?.data);
}

/**
 * Idempotent by `normalizedEmail` — "Identity must never be duplicated
 * between organizations": inviting the same email to a second
 * organization (see `services/invitationService.ts`) always finds and
 * reuses this same identity, never creates a second one.
 */
export async function findOrCreateIdentity(
  params: { email: string; displayName: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ identity: Identity; isNew: boolean }> {
  const existing = await findIdentityByEmail(params.email, dataAdapterMode);
  if (existing) return { identity: existing, isNew: false };

  const now = nowIso();
  const identity: Identity = {
    id: params.idFactory(),
    email: params.email,
    normalizedEmail: normalizeEmail(params.email),
    displayName: params.displayName,
    phone: null,
    status: 'pending',
    emailVerified: false,
    passwordVersion: 0,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const secrets: IdentitySecrets = {
    passwordHash: null,
    mfaSecretReference: null,
    mfaVerifiedAt: null,
    mfaRecoveryCodeHashes: [],
  };

  if (dataAdapterMode === 'mock') {
    identityFixtures.push({ ...identity, ...secrets });
    return { identity, isNew: true };
  }

  try {
    const inserted = await insertWixDataItem<WixIdentityItem>('identities', buildWixIdentityData(identity, secrets), identity.id);
    const mapped = mapWixIdentityItem(inserted.data);
    if (!mapped) throw new Error('Failed to create identity.');
    return { identity: mapped, isNew: true };
  } catch (error) {
    if (!isWixConflict(error)) throw error;
    const reFetched = await findIdentityByEmail(params.email, dataAdapterMode);
    if (!reFetched) throw error;
    return { identity: reFetched, isNew: false };
  }
}

export async function updateIdentity(
  identityId: string,
  patch: Partial<Identity>,
  dataAdapterMode: DataAdapterMode,
): Promise<Identity | null> {
  const nextPatch = { ...patch, updatedAt: nowIso() };

  if (dataAdapterMode === 'mock') {
    const index = identityFixtures.findIndex((i) => i.id === identityId);
    if (index === -1) return null;
    identityFixtures[index] = { ...identityFixtures[index], ...nextPatch };
    return splitMockRecord(identityFixtures[index]).identity;
  }

  const response = await queryWixDataItems<WixIdentityItem>('identities', {
    filter: { beaconIdentityId: identityId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyIdentityUpdateToWixData(existingItem.data, nextPatch);
  const updated = await updateWixDataItem<WixIdentityItem>('identities', existingItem.id, merged);
  return mapWixIdentityItem(updated.data);
}

export async function recordSuccessfulLogin(identityId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  await updateIdentity(identityId, { lastLoginAt: nowIso() }, dataAdapterMode);
}

// ---------------------------------------------------------------------------
// Secrets — the only exported accessors to passwordHash/MFA material.
// Used exclusively by services/passwordService.ts and services/mfaService.ts.
// ---------------------------------------------------------------------------

export async function getIdentitySecrets(identityId: string, dataAdapterMode: DataAdapterMode): Promise<IdentitySecrets | null> {
  if (dataAdapterMode === 'mock') {
    const record = identityFixtures.find((i) => i.id === identityId);
    return record ? splitMockRecord(record).secrets : null;
  }
  const response = await queryWixDataItems<WixIdentityItem>('identities', {
    filter: { beaconIdentityId: identityId },
    paging: { limit: 1 },
  });
  return mapWixIdentitySecrets(response.dataItems[0]?.data);
}

export async function updateIdentitySecrets(
  identityId: string,
  patch: Partial<IdentitySecrets>,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = identityFixtures.findIndex((i) => i.id === identityId);
    if (index === -1) return;
    identityFixtures[index] = { ...identityFixtures[index], ...patch };
    return;
  }

  const response = await queryWixDataItems<WixIdentityItem>('identities', {
    filter: { beaconIdentityId: identityId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  const merged = applyIdentityUpdateToWixData(existingItem.data, patch);
  await updateWixDataItem<WixIdentityItem>('identities', existingItem.id, merged);
}
