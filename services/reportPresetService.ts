import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, deleteWixDataItem } from '../lib/wixDataApi';
import { mapWixReportPresetItem, buildWixReportPresetData, type WixReportPresetItem } from '../lib/wixReportPresetMapper';
import type { ReportPreset, NewReportPresetInput } from '../types/reportPreset';
import { reportPresetFixtures } from './__mocks__/reportingFixtures';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). CRUD for saved
 * report filter presets — the sole writer of `reportPresets`. Deliberately
 * small: name, owner, organization scope, a serialized filter blob. No
 * scheduled email delivery, no arbitrary query builder (see this phase's
 * own Saved Reports scope boundary).
 */
export class ReportPresetServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

/** Own + shared presets for one report, this organization only — never
    another organization's presets, and never a preset owned by a
    different identity unless it's `isShared`. */
export async function list(
  organizationId: string,
  callerIdentityId: string,
  filters: { reportKey?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<ReportPreset[]> {
  let presets: ReportPreset[];
  if (dataAdapterMode === 'mock') {
    presets = reportPresetFixtures.filter((p) => p.organizationId === organizationId);
  } else {
    const filter: Record<string, unknown> = { organizationId };
    if (filters.reportKey) filter.reportKey = filters.reportKey;
    const response = await queryWixDataItems<WixReportPresetItem>('reportPresets', { filter });
    presets = response.dataItems.map((item) => mapWixReportPresetItem(item.data)).filter((p): p is ReportPreset => p !== null);
  }
  return presets
    .filter((p) => (filters.reportKey ? p.reportKey === filters.reportKey : true))
    .filter((p) => p.ownerIdentityId === callerIdentityId || p.isShared)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function create(
  organizationId: string,
  params: NewReportPresetInput & { ownerIdentityId: string; canManageDashboard: boolean; idFactory: () => string; now?: string },
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<ReportPreset> {
  if (params.isShared && !params.canManageDashboard) {
    throw new ReportPresetServiceError('Only a caller with dashboard.manage may save an organization-wide shared preset.');
  }
  const now = params.now ?? nowIso();
  const preset: ReportPreset = {
    id: params.idFactory(),
    organizationId,
    reportKey: params.reportKey,
    name: params.name,
    ownerIdentityId: params.ownerIdentityId,
    filters: params.filters,
    isShared: params.isShared ?? false,
    createdAt: now,
    updatedAt: now,
  };
  if (dataAdapterMode === 'mock') {
    reportPresetFixtures.push(preset);
    return preset;
  }
  await insertWixDataItem<WixReportPresetItem>('reportPresets', buildWixReportPresetData(preset), preset.id);
  return preset;
}

/** Removes a preset — the caller's own, or any shared one if they have
    `dashboard.manage`. Never another owner's private preset. */
export async function remove(
  organizationId: string,
  presetId: string,
  caller: { identityId: string; canManageDashboard: boolean },
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = reportPresetFixtures.findIndex((p) => p.id === presetId && p.organizationId === organizationId);
    if (index === -1) throw new ReportPresetServiceError('Report preset not found.');
    const preset = reportPresetFixtures[index];
    if (preset.ownerIdentityId !== caller.identityId && !(preset.isShared && caller.canManageDashboard)) {
      throw new ReportPresetServiceError('Not authorized to remove this report preset.');
    }
    reportPresetFixtures.splice(index, 1);
    return;
  }
  const response = await queryWixDataItems<WixReportPresetItem>('reportPresets', { filter: { organizationId, beaconReportPresetId: presetId }, paging: { limit: 1 } });
  const item = response.dataItems[0];
  const mapped = item ? mapWixReportPresetItem(item.data) : null;
  if (!item || !mapped) throw new ReportPresetServiceError('Report preset not found.');
  if (mapped.ownerIdentityId !== caller.identityId && !(mapped.isShared && caller.canManageDashboard)) {
    throw new ReportPresetServiceError('Not authorized to remove this report preset.');
  }
  await deleteWixDataItem('reportPresets', item.id);
}
