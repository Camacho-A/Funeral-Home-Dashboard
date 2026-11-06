import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import { WixDataApiError } from '@/lib/wixDataApi';
import { faxTableFor } from '../faxBundles/faxBundleStore';
import { DEFAULT_FAX_PROVIDER_KEY, isFaxProviderKey } from '@/domain/faxBundles/faxProviders';
import { FAX_CONFIGURATION_RECORD_VERSION, type FaxDestination, type FaxSettingsRecord } from '@/domain/faxBundles/faxConfiguration';

/**
 * Fax Settings (2026-11) — persistence. Two Wix collections
 * (docs/FAX_SETTINGS.md §Schema), same table as the fax bundles (Wix live,
 * in memory for mock mode and tests), same contract:
 *   faxDestinations  one row per destination, random id; every change is
 *                    conditioned on its `revision`;
 *   faxSettings      one row per organization with a FIXED id (hashed with
 *                    the organization), so two first saves cannot both
 *                    create one — Wix refuses the second insert (409).
 * Every read is filtered by organizationId as well as by id.
 *
 * Only services/faxSettings/faxSettingsService.ts may import this module
 * (enforced by faxSettingsService.test.ts).
 */

export const FAX_DESTINATIONS_COLLECTION = 'faxDestinations';
export const FAX_SETTINGS_COLLECTION = 'faxSettings';

type Row = Record<string, unknown>;

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);
export const newFaxDestinationId = () => `fxd-${crypto.randomUUID().replace(/-/g, '')}`;
export const faxSettingsId = (organizationId: string) => `fxs-${hash(`fax-settings|${organizationId}`)}`;
export const isFaxDestinationId = (value: unknown): value is string => typeof value === 'string' && /^fxd-[0-9a-f]{32}$/.test(value);

/**
 * Reads only: a collection that does not exist yet (the migration not run)
 * reads as "nothing stored", so the built-in values apply and fax bundles
 * keep working exactly as before. Writes are never softened.
 */
async function readRows(collection: string, filter: Record<string, unknown>, mode: DataAdapterMode, options?: { limit?: number }): Promise<Row[]> {
  try {
    return await faxTableFor(mode).find(collection, filter, options);
  } catch (error) {
    if (error instanceof WixDataApiError && error.status === 404) return [];
    throw error;
  }
}

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const strOrNull = (value: unknown) => (typeof value === 'string' && value ? value : null);
const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

// ---------------------------------------------------------------- destinations

function destinationToRow(d: FaxDestination): Row {
  const { id, ...rest } = d;
  return { beaconFaxDestinationId: id, ...rest };
}

function destinationFromRow(row: Row): FaxDestination {
  return {
    id: str(row.beaconFaxDestinationId),
    organizationId: str(row.organizationId),
    name: str(row.name),
    faxNumber: str(row.faxNumber),
    providerKey: isFaxProviderKey(row.providerKey) ? row.providerKey : DEFAULT_FAX_PROVIDER_KEY,
    purpose: str(row.purpose),
    status: row.status === 'archived' ? 'archived' : 'active',
    revision: num(row.revision),
    recordVersion: num(row.recordVersion, FAX_CONFIGURATION_RECORD_VERSION),
    createdAt: str(row.createdAt),
    createdBy: strOrNull(row.createdBy),
    updatedAt: str(row.updatedAt),
    updatedBy: strOrNull(row.updatedBy),
    archivedAt: strOrNull(row.archivedAt),
    archivedBy: strOrNull(row.archivedBy),
  };
}

export async function insertFaxDestination(destination: FaxDestination, mode: DataAdapterMode): Promise<'inserted' | 'exists'> {
  return faxTableFor(mode).insert(FAX_DESTINATIONS_COLLECTION, destination.id, destinationToRow(destination));
}

export async function getFaxDestination(organizationId: string, destinationId: string, mode: DataAdapterMode): Promise<FaxDestination | null> {
  if (!isFaxDestinationId(destinationId)) return null;
  const [row] = await readRows(FAX_DESTINATIONS_COLLECTION, { beaconFaxDestinationId: destinationId, organizationId }, mode, { limit: 1 });
  return row ? destinationFromRow(row) : null;
}

export async function listFaxDestinationRecords(organizationId: string, mode: DataAdapterMode): Promise<FaxDestination[]> {
  const rows = await readRows(FAX_DESTINATIONS_COLLECTION, { organizationId }, mode);
  return rows.map(destinationFromRow).filter((d) => d.organizationId === organizationId);
}

/** Applies `patch` only if the destination is still at `expected.revision`. Null when someone else changed it first. */
export async function updateFaxDestinationIf(
  expected: Pick<FaxDestination, 'id' | 'organizationId' | 'revision'>,
  patch: Partial<Pick<FaxDestination, 'name' | 'faxNumber' | 'purpose' | 'providerKey' | 'status' | 'archivedAt' | 'archivedBy'>> & Pick<FaxDestination, 'updatedAt' | 'updatedBy'>,
  mode: DataAdapterMode,
): Promise<FaxDestination | null> {
  const outcome = await faxTableFor(mode).patchIf(FAX_DESTINATIONS_COLLECTION, expected.id, { ...patch, revision: expected.revision + 1 }, { organizationId: expected.organizationId, revision: expected.revision });
  if (outcome !== 'applied') return null;
  return getFaxDestination(expected.organizationId, expected.id, mode);
}

// ---------------------------------------------------------------- settings

function settingsToRow(s: FaxSettingsRecord): Row {
  const { id, ...rest } = s;
  return { beaconFaxSettingsId: id, ...rest };
}

function settingsFromRow(row: Row): FaxSettingsRecord {
  return {
    id: str(row.beaconFaxSettingsId),
    organizationId: str(row.organizationId),
    providerKey: isFaxProviderKey(row.providerKey) ? row.providerKey : DEFAULT_FAX_PROVIDER_KEY,
    defaultDestinationId: strOrNull(row.defaultDestinationId),
    subjectTemplate: str(row.subjectTemplate),
    bodyEnabled: row.bodyEnabled === true,
    bodyTemplate: str(row.bodyTemplate),
    coverPageEnabled: row.coverPageEnabled === true,
    revision: num(row.revision),
    recordVersion: num(row.recordVersion, FAX_CONFIGURATION_RECORD_VERSION),
    createdAt: str(row.createdAt),
    createdBy: strOrNull(row.createdBy),
    updatedAt: str(row.updatedAt),
    updatedBy: strOrNull(row.updatedBy),
  };
}

export async function getFaxSettingsRecord(organizationId: string, mode: DataAdapterMode): Promise<FaxSettingsRecord | null> {
  const [row] = await readRows(FAX_SETTINGS_COLLECTION, { beaconFaxSettingsId: faxSettingsId(organizationId), organizationId }, mode, { limit: 1 });
  return row ? settingsFromRow(row) : null;
}

/** 'exists' when the organization already has its settings row (someone else saved first). */
export async function insertFaxSettingsRecord(record: FaxSettingsRecord, mode: DataAdapterMode): Promise<'inserted' | 'exists'> {
  return faxTableFor(mode).insert(FAX_SETTINGS_COLLECTION, record.id, settingsToRow(record));
}

export async function updateFaxSettingsIf(
  expected: Pick<FaxSettingsRecord, 'id' | 'organizationId' | 'revision'>,
  patch: Partial<Pick<FaxSettingsRecord, 'providerKey' | 'defaultDestinationId' | 'subjectTemplate' | 'bodyEnabled' | 'bodyTemplate' | 'coverPageEnabled'>> & Pick<FaxSettingsRecord, 'updatedAt' | 'updatedBy'>,
  mode: DataAdapterMode,
): Promise<FaxSettingsRecord | null> {
  const outcome = await faxTableFor(mode).patchIf(FAX_SETTINGS_COLLECTION, expected.id, { ...patch, revision: expected.revision + 1 }, { organizationId: expected.organizationId, revision: expected.revision });
  if (outcome !== 'applied') return null;
  return getFaxSettingsRecord(expected.organizationId, mode);
}
