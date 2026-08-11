import type { ReportPreset } from '../types/reportPreset';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The one place a
 * raw Wix `reportPresets` item is ever touched. `reportPresetService.ts`
 * is this collection's sole writer.
 */
export type WixReportPresetItem = {
  beaconReportPresetId?: unknown;
  organizationId?: unknown;
  reportKey?: unknown;
  name?: unknown;
  ownerIdentityId?: unknown;
  filters?: unknown;
  isShared?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixReportPresetItem(item: WixReportPresetItem | undefined): ReportPreset | null {
  if (
    !item ||
    typeof item.beaconReportPresetId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.reportKey !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.ownerIdentityId !== 'string' ||
    typeof item.filters !== 'string' ||
    typeof item.isShared !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconReportPresetId,
    organizationId: item.organizationId,
    reportKey: item.reportKey,
    name: item.name,
    ownerIdentityId: item.ownerIdentityId,
    filters: item.filters,
    isShared: item.isShared,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixReportPresetData(preset: ReportPreset): WixReportPresetItem {
  return {
    beaconReportPresetId: preset.id,
    organizationId: preset.organizationId,
    reportKey: preset.reportKey,
    name: preset.name,
    ownerIdentityId: preset.ownerIdentityId,
    filters: preset.filters,
    isShared: preset.isShared,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  };
}
