import type { BillingSupplementalConfig, BillingSupplementalBlock } from '../types/billingSupplementalConfig';

/**
 * Phase 39. Maps a `billingSupplementalConfigs` row. The variable-length
 * optional `blocks` are JSON-encoded in a Text column (same convention as
 * other nested Wix data). Only OPTIONAL supplemental language lives here —
 * mandatory federal disclosures are system-locked in the compliance registry.
 */
export type WixBillingSupplementalConfigItem = {
  beaconBillingSupplementalConfigId?: unknown;
  organizationId?: unknown;
  version?: unknown;
  blocksJson?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function parseBlocks(value: unknown): BillingSupplementalBlock[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is BillingSupplementalBlock =>
        b && typeof b.key === 'string' && (b.document === 'general_price_list' || b.document === 'statement_of_goods_and_services') && typeof b.text === 'string',
    );
  } catch {
    return [];
  }
}

export function mapWixBillingSupplementalConfigItem(item: WixBillingSupplementalConfigItem | undefined): BillingSupplementalConfig | null {
  if (
    !item ||
    typeof item.beaconBillingSupplementalConfigId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.version !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconBillingSupplementalConfigId,
    organizationId: item.organizationId,
    version: item.version,
    blocks: parseBlocks(item.blocksJson),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixBillingSupplementalConfigData(config: BillingSupplementalConfig): WixBillingSupplementalConfigItem {
  return {
    beaconBillingSupplementalConfigId: config.id,
    organizationId: config.organizationId,
    version: config.version,
    blocksJson: JSON.stringify(config.blocks),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}
