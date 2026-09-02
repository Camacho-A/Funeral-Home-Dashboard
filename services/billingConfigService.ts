import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem } from '../lib/wixDataApi';
import {
  mapWixBillingSupplementalConfigItem,
  buildWixBillingSupplementalConfigData,
  type WixBillingSupplementalConfigItem,
} from '../lib/wixBillingSupplementalConfigMapper';
import type { BillingSupplementalConfig, BillingSupplementalBlock } from '../types/billingSupplementalConfig';
import { billingSupplementalConfigFixtures } from './__mocks__/billingFixtures';

/**
 * Phase 39 (Family Billing & FTC Compliance). Reads/writes an organization's
 * OPTIONAL supplemental compliance language (D6). Mandatory federal wording is
 * system-locked in `domain/billing/ftcComplianceRegistry.ts` and is NOT
 * touched here. Each edit appends a new version (history is preserved), so a
 * generated document can record which supplemental version it rendered.
 * A missing config resolves to an empty (version 0) config — never eagerly
 * seeded.
 */
const COLLECTION = 'billingSupplementalConfigs';

function nowIso(): string {
  return new Date().toISOString();
}

function emptyConfig(organizationId: string): BillingSupplementalConfig {
  return { id: `${organizationId}-supplemental-0`, organizationId, version: 0, blocks: [], createdAt: '', updatedAt: '' };
}

/** Returns the current (highest-version) supplemental config, or an empty one. */
export async function getSupplementalConfig(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<BillingSupplementalConfig> {
  const all =
    dataAdapterMode === 'mock'
      ? billingSupplementalConfigFixtures.filter((c) => c.organizationId === organizationId)
      : (await queryWixDataItems<WixBillingSupplementalConfigItem>(COLLECTION, { filter: { organizationId } })).dataItems
          .map((i) => mapWixBillingSupplementalConfigItem(i.data))
          .filter((c): c is BillingSupplementalConfig => c !== null);
  if (all.length === 0) return emptyConfig(organizationId);
  return all.reduce((latest, c) => (c.version > latest.version ? c : latest));
}

/** Appends a new supplemental-config version. `blocks` is the complete new set
    of OPTIONAL blocks. Never accepts or stores mandatory disclosure text. */
export async function updateSupplementalConfig(
  params: { organizationId: string; blocks: BillingSupplementalBlock[]; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<BillingSupplementalConfig> {
  const current = await getSupplementalConfig(params.organizationId, dataAdapterMode);
  const now = nowIso();
  const next: BillingSupplementalConfig = {
    id: params.idFactory(),
    organizationId: params.organizationId,
    version: current.version + 1,
    blocks: params.blocks.map((b) => ({ key: b.key, document: b.document, text: b.text })),
    createdAt: now,
    updatedAt: now,
  };
  if (dataAdapterMode === 'mock') {
    billingSupplementalConfigFixtures.push(next);
    return next;
  }
  await insertWixDataItem<WixBillingSupplementalConfigItem>(COLLECTION, buildWixBillingSupplementalConfigData(next), next.id);
  return next;
}
