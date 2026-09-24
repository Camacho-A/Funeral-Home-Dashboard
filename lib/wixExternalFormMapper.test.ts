import { describe, expect, it } from 'vitest';
import { mapWixExternalFormConfigItem, buildWixExternalFormConfigData, type WixExternalFormConfigItem } from './wixExternalFormMapper';
import type { ExternalFormConfig } from '@/types/externalFormConfig';

const VALID_CONFIG: ExternalFormConfig = {
  id: 'extform-config-managed-cremations-jotform-vital-statistics',
  organizationId: 'managed-cremations',
  provider: 'jotform',
  externalFormId: '262605621454050',
  label: 'Vital Statistics',
  audience: 'family',
  fieldMap: '{}',
  linkTokenFieldName: 'solisLinkToken',
  linkTokenFieldQid: '44',
  webhookAuthFieldQid: '45',
  isEnabled: true,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
};

describe('ExternalFormConfig Wix mapper — round trip', () => {
  it('buildWixExternalFormConfigData -> mapWixExternalFormConfigItem preserves every field, including the new qid identifiers', () => {
    const wixData = buildWixExternalFormConfigData(VALID_CONFIG);
    const mapped = mapWixExternalFormConfigItem(VALID_CONFIG.id, wixData);
    expect(mapped).toEqual(VALID_CONFIG);
    expect(mapped?.linkTokenFieldQid).toBe('44');
    expect(mapped?.webhookAuthFieldQid).toBe('45');
  });

  it('preserves the Arrangement Forms qid values distinctly from Vital Statistics', () => {
    const arrangementConfig: ExternalFormConfig = {
      ...VALID_CONFIG,
      id: 'extform-config-managed-cremations-jotform-arrangement-forms',
      externalFormId: '261945978664175',
      label: 'Arrangement Forms',
      audience: 'staff',
      linkTokenFieldQid: '274',
      webhookAuthFieldQid: '275',
    };
    const mapped = mapWixExternalFormConfigItem(arrangementConfig.id, buildWixExternalFormConfigData(arrangementConfig));
    expect(mapped?.linkTokenFieldQid).toBe('274');
    expect(mapped?.webhookAuthFieldQid).toBe('275');
  });
});

describe('ExternalFormConfig Wix mapper — fails safe on a malformed/incomplete row', () => {
  it('returns null when linkTokenFieldQid is missing', () => {
    const item: WixExternalFormConfigItem = { ...buildWixExternalFormConfigData(VALID_CONFIG) };
    delete item.linkTokenFieldQid;
    expect(mapWixExternalFormConfigItem(VALID_CONFIG.id, item)).toBeNull();
  });

  it('returns null when webhookAuthFieldQid is missing', () => {
    const item: WixExternalFormConfigItem = { ...buildWixExternalFormConfigData(VALID_CONFIG) };
    delete item.webhookAuthFieldQid;
    expect(mapWixExternalFormConfigItem(VALID_CONFIG.id, item)).toBeNull();
  });

  it('returns null when linkTokenFieldQid is the wrong type (not a string)', () => {
    const item: WixExternalFormConfigItem = { ...buildWixExternalFormConfigData(VALID_CONFIG), linkTokenFieldQid: 44 };
    expect(mapWixExternalFormConfigItem(VALID_CONFIG.id, item)).toBeNull();
  });

  it('returns null for a completely undefined item', () => {
    expect(mapWixExternalFormConfigItem('some-id', undefined)).toBeNull();
  });
});
