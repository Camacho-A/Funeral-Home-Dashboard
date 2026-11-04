import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import {
  WixDataApiError,
  conditionalPatchWixDataItemFields,
  deleteWixDataItem,
  insertWixDataItem,
  queryAllWixDataItems,
  queryWixDataItems,
} from '@/lib/wixDataApi';
import { FAX_BUNDLE_PURPOSE, type FaxBundle, type FaxBundleHistoryEntry, type FaxBundleItem, type FaxBundleStatus } from '@/domain/faxBundles/faxBundle';

/**
 * Manatee County DC application fax bundles (2026-11) — persistence.
 *
 * Two Wix collections (docs/MANATEE_FAX_BUNDLES.md §Schema):
 *   faxBundles      one row per bundle; every change is conditioned on its
 *                   `revision` (a stale writer changes nothing);
 *   faxBundleCases  `link` rows (which bundles a case was in) and `claim`
 *                   rows — one per case, with a FIXED id — that hold a case
 *                   for one bundle. Wix refuses a second insert of the same
 *                   id (HTTP 409), so two bundles can never both hold a
 *                   case, whichever server instance runs them.
 *
 * Every read is filtered by organizationId; ids are hashed with it. Mock
 * mode (and tests) uses an in-memory table with the same semantics: 409 on
 * a duplicate id, "condition not met" on a stale revision.
 */

export const FAX_BUNDLES_COLLECTION = 'faxBundles';
export const FAX_BUNDLE_CASES_COLLECTION = 'faxBundleCases';

type Row = Record<string, unknown>;
type Filter = Record<string, unknown>;

export type Table = {
  insert(collection: string, id: string, data: Row): Promise<'inserted' | 'exists'>;
  find(collection: string, filter: Filter, options?: { limit?: number }): Promise<Row[]>;
  /** Sets `fields` only if every `condition` field still equals its value. */
  patchIf(collection: string, id: string, fields: Row, condition: Row): Promise<'applied' | 'conflict'>;
  remove(collection: string, id: string): Promise<void>;
};

// ---------------------------------------------------------------- tables

const wixTable: Table = {
  async insert(collection, id, data) {
    try {
      await insertWixDataItem(collection, data, id);
      return 'inserted';
    } catch (error) {
      if (error instanceof WixDataApiError && error.status === 409) return 'exists';
      throw error;
    }
  },
  async find(collection, filter, options) {
    if (options?.limit) return (await queryWixDataItems<Row>(collection, { filter, paging: { limit: options.limit } })).dataItems.map((i) => i.data);
    return (await queryAllWixDataItems<Row>(collection, filter)).map((i) => i.data);
  },
  async patchIf(collection, id, fields, condition) {
    const filter = Object.fromEntries(Object.entries(condition).map(([k, v]) => [k, { $eq: v }]));
    const result = await conditionalPatchWixDataItemFields(collection, id, fields, { filter });
    if (result.applied) return 'applied';
    // 428 (WDE0193): the condition was not met. 404: no such row. Anything else is a failure.
    if (result.status === 428 || result.status === 412 || result.status === 404) return 'conflict';
    throw new WixDataApiError(`Wix Data conditional update failed for collection "${collection}" (HTTP ${result.status}).`, result.status);
  },
  async remove(collection, id) {
    try {
      await deleteWixDataItem(collection, id);
    } catch (error) {
      if (error instanceof WixDataApiError && error.status === 404) return;
      throw error;
    }
  },
};

function matches(row: Row, filter: Filter): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const op = expected as Record<string, unknown>;
      if ('$eq' in op) return actual === op.$eq;
      if ('$in' in op) return (op.$in as unknown[]).includes(actual);
      if ('$lt' in op) return typeof actual === 'string' && actual < (op.$lt as string);
      return false;
    }
    return actual === expected;
  });
}

/** In-memory table: mock mode and tests. Same refusals as Wix. */
export function createMemoryTable(): Table & { rows(collection: string): Row[]; reset(): void } {
  const collections = new Map<string, Map<string, Row>>();
  const of = (collection: string) => {
    if (!collections.has(collection)) collections.set(collection, new Map());
    return collections.get(collection)!;
  };
  const copy = <T,>(value: T): T => structuredClone(value);
  return {
    async insert(collection, id, data) {
      const rows = of(collection);
      if (rows.has(id)) return 'exists';
      rows.set(id, copy(data));
      return 'inserted';
    },
    async find(collection, filter, options) {
      const found = [...of(collection).values()].filter((row) => matches(row, filter)).map(copy);
      return options?.limit ? found.slice(0, options.limit) : found;
    },
    async patchIf(collection, id, fields, condition) {
      const rows = of(collection);
      const row = rows.get(id);
      if (!row || !matches(row, condition)) return 'conflict';
      rows.set(id, { ...row, ...copy(fields) });
      return 'applied';
    },
    async remove(collection, id) {
      of(collection).delete(id);
    },
    rows: (collection) => [...of(collection).values()].map(copy),
    reset: () => collections.clear(),
  };
}

export const memoryFaxTable = createMemoryTable();

let tableOverride: Table | null = null;
/** Tests only: route every mode through this table. */
export function setFaxTableForTesting(table: Table | null): void {
  tableOverride = table;
}
const tableFor = (mode: DataAdapterMode): Table => tableOverride ?? (mode === 'mock' ? memoryFaxTable : wixTable);

// ---------------------------------------------------------------- ids

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);
export const newFaxBundleId = () => `fxb-${crypto.randomUUID().replace(/-/g, '')}`;
export const faxLinkId = (organizationId: string, bundleId: string, caseId: string) => `fxl-${hash(`${organizationId}|${bundleId}|${caseId}`)}`;
export const faxClaimId = (organizationId: string, caseId: string) => `fxc-${hash(`${organizationId}|${FAX_BUNDLE_PURPOSE}|${caseId}`)}`;

// ---------------------------------------------------------------- bundles

function toRow(bundle: FaxBundle): Row {
  const { id, ...rest } = bundle;
  return { beaconFaxBundleId: id, ...rest };
}

function fromRow(row: Row): FaxBundle {
  const { beaconFaxBundleId, ...rest } = row as Row & { beaconFaxBundleId: string };
  const bundle = rest as unknown as Omit<FaxBundle, 'id'>;
  return {
    ...bundle,
    id: beaconFaxBundleId,
    revision: typeof bundle.revision === 'number' ? bundle.revision : 0,
    items: Array.isArray(bundle.items) ? (bundle.items as FaxBundleItem[]) : [],
    caseIds: Array.isArray(bundle.caseIds) ? bundle.caseIds : [],
    history: Array.isArray(bundle.history) ? (bundle.history as FaxBundleHistoryEntry[]) : [],
  };
}

export async function insertFaxBundle(bundle: FaxBundle, mode: DataAdapterMode): Promise<'inserted' | 'exists'> {
  return tableFor(mode).insert(FAX_BUNDLES_COLLECTION, bundle.id, toRow(bundle));
}

export async function getFaxBundle(organizationId: string, bundleId: string, mode: DataAdapterMode): Promise<FaxBundle | null> {
  if (!/^fxb-[0-9a-f]{32}$/.test(bundleId)) return null;
  const [row] = await tableFor(mode).find(FAX_BUNDLES_COLLECTION, { beaconFaxBundleId: bundleId, organizationId }, { limit: 1 });
  return row ? fromRow(row) : null;
}

export async function findFaxBundleByReference(organizationId: string, reference: string, mode: DataAdapterMode): Promise<FaxBundle | null> {
  const [row] = await tableFor(mode).find(FAX_BUNDLES_COLLECTION, { organizationId, reference }, { limit: 1 });
  return row ? fromRow(row) : null;
}

export async function listFaxBundlesByStatus(organizationId: string, statuses: readonly FaxBundleStatus[], mode: DataAdapterMode): Promise<FaxBundle[]> {
  return (await tableFor(mode).find(FAX_BUNDLES_COLLECTION, { organizationId, status: { $in: [...statuses] } })).map(fromRow);
}

/**
 * Applies `patch` to the bundle ONLY if it is still at `expected.revision`
 * (and in `expected.status`), appending one history entry. Null when
 * another writer got there first — the caller re-reads, never assumes.
 */
export async function updateFaxBundleIf(
  expected: Pick<FaxBundle, 'id' | 'organizationId' | 'revision' | 'status' | 'history'>,
  patch: Partial<Omit<FaxBundle, 'id' | 'organizationId' | 'revision' | 'history' | 'updatedAt'>>,
  entry: Omit<FaxBundleHistoryEntry, 'fromStatus' | 'toStatus' | 'at'> & { at?: string },
  mode: DataAdapterMode,
): Promise<FaxBundle | null> {
  const at = entry.at ?? new Date().toISOString();
  const toStatus = patch.status ?? expected.status;
  const history: FaxBundleHistoryEntry[] = [...expected.history, { ...entry, at, fromStatus: expected.status, toStatus }];
  const fields = { ...patch, revision: expected.revision + 1, updatedAt: at, history };
  const outcome = await tableFor(mode).patchIf(FAX_BUNDLES_COLLECTION, expected.id, fields, {
    organizationId: expected.organizationId,
    revision: expected.revision,
    status: expected.status,
  });
  if (outcome !== 'applied') return null;
  return getFaxBundle(expected.organizationId, expected.id, mode);
}

// ---------------------------------------------------------------- case links and claims

export type FaxCaseClaim = { caseId: string; bundleId: string; createdAt: string };

/** Holds the case for this bundle. `held` names the bundle that already holds it. */
export async function claimCaseForFaxBundle(
  organizationId: string,
  caseId: string,
  bundleId: string,
  mode: DataAdapterMode,
): Promise<{ claimed: true } | { claimed: false; heldBy: string | null }> {
  const id = faxClaimId(organizationId, caseId);
  const outcome = await tableFor(mode).insert(FAX_BUNDLE_CASES_COLLECTION, id, {
    beaconFaxBundleCaseId: id,
    organizationId,
    kind: 'claim',
    bundleId,
    caseId,
    createdAt: new Date().toISOString(),
  });
  if (outcome === 'inserted') return { claimed: true };
  const existing = await getFaxCaseClaim(organizationId, caseId, mode);
  if (existing?.bundleId === bundleId) return { claimed: true };
  return { claimed: false, heldBy: existing?.bundleId ?? null };
}

export async function getFaxCaseClaim(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<FaxCaseClaim | null> {
  const [row] = await tableFor(mode).find(FAX_BUNDLE_CASES_COLLECTION, { beaconFaxBundleCaseId: faxClaimId(organizationId, caseId), organizationId }, { limit: 1 });
  return row ? { caseId: String(row.caseId), bundleId: String(row.bundleId), createdAt: String(row.createdAt) } : null;
}

export async function listFaxCaseClaims(organizationId: string, mode: DataAdapterMode): Promise<FaxCaseClaim[]> {
  return (await tableFor(mode).find(FAX_BUNDLE_CASES_COLLECTION, { organizationId, kind: 'claim' })).map((row) => ({
    caseId: String(row.caseId),
    bundleId: String(row.bundleId),
    createdAt: String(row.createdAt),
  }));
}

/** Releases the case — only if THIS bundle holds it. */
export async function releaseFaxCaseClaim(organizationId: string, caseId: string, bundleId: string, mode: DataAdapterMode): Promise<void> {
  const claim = await getFaxCaseClaim(organizationId, caseId, mode);
  if (claim?.bundleId !== bundleId) return;
  await tableFor(mode).remove(FAX_BUNDLE_CASES_COLLECTION, faxClaimId(organizationId, caseId));
}

/** Idempotent: the same bundle and case always resolve to the same row. */
export async function linkCaseToFaxBundle(organizationId: string, bundle: Pick<FaxBundle, 'id' | 'applicationCount'>, item: FaxBundleItem, mode: DataAdapterMode): Promise<void> {
  const id = faxLinkId(organizationId, bundle.id, item.caseId);
  await tableFor(mode).insert(FAX_BUNDLE_CASES_COLLECTION, id, {
    beaconFaxBundleCaseId: id,
    organizationId,
    kind: 'link',
    bundleId: bundle.id,
    caseId: item.caseId,
    position: item.position,
    applicationCount: bundle.applicationCount,
    documentId: item.documentId,
    documentVersion: item.documentVersion,
    createdAt: new Date().toISOString(),
  });
}

export async function listFaxBundleIdsForCase(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<string[]> {
  const rows = await tableFor(mode).find(FAX_BUNDLE_CASES_COLLECTION, { organizationId, caseId, kind: 'link' });
  return [...new Set(rows.map((row) => String(row.bundleId)))];
}
