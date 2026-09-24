import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems } from '../lib/wixDataApi';
import { mapWixExternalFormConfigItem, type WixExternalFormConfigItem } from '../lib/wixExternalFormMapper';
import type { ExternalFormConfig } from '../types/externalFormConfig';
import { externalFormConfigFixtures } from './__mocks__/externalFormFixtures';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Read-only
 * for this MVP — configuration rows are seeded (mock fixtures today; a
 * one-time Wix data seed once this collection exists in production, see
 * this integration's own report for the exact schema), never created or
 * edited through the running application. No Manors-specific form ID
 * appears anywhere outside this collection's own rows.
 */
export async function listForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormConfig[]> {
  if (dataAdapterMode === 'mock') {
    return externalFormConfigFixtures.filter((c) => c.organizationId === organizationId && c.isEnabled);
  }
  const response = await queryWixDataItems<WixExternalFormConfigItem>('externalFormConfigs', {
    filter: { organizationId, isEnabled: true },
  });
  return response.dataItems
    .map((item) => mapWixExternalFormConfigItem(item.id, item.data))
    .filter((c): c is ExternalFormConfig => c !== null);
}

export async function getById(organizationId: string, configId: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormConfig | null> {
  const all = await listForOrganization(organizationId, dataAdapterMode);
  return all.find((c) => c.id === configId) ?? null;
}

/** Resolves which organization+config a webhook delivery belongs to,
    from Solis's own stored configuration — never trusted from the
    webhook payload itself (mirrors the Clover webhook's own
    organization-resolution principle exactly). Returns null for an
    unrecognized (provider, externalFormId) pair — the webhook route
    treats that as "no allowlisted form," never a crash. */
export async function findByProviderFormId(
  provider: string,
  externalFormId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ExternalFormConfig | null> {
  if (dataAdapterMode === 'mock') {
    return externalFormConfigFixtures.find((c) => c.provider === provider && c.externalFormId === externalFormId && c.isEnabled) ?? null;
  }
  const response = await queryWixDataItems<WixExternalFormConfigItem>('externalFormConfigs', {
    filter: { provider, externalFormId, isEnabled: true },
    paging: { limit: 1 },
  });
  const item = response.dataItems[0];
  if (!item) return null;
  return mapWixExternalFormConfigItem(item.id, item.data);
}
