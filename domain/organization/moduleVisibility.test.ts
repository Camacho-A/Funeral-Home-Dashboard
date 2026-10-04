import { describe, expect, it } from 'vitest';
import { isModuleEnabled, isModuleHidden, MANORS_ORGANIZATION_ID, HIDEABLE_MODULE_KEYS } from './moduleVisibility';

describe('isModuleEnabled', () => {
  it('is hidden by default when the organization has no enabledModules configured', () => {
    expect(isModuleEnabled({ enabledModules: undefined }, 'merchandise')).toBe(false);
    expect(isModuleEnabled({ enabledModules: null }, 'merchandise')).toBe(false);
    expect(isModuleEnabled(null, 'merchandise')).toBe(false);
    expect(isModuleEnabled(undefined, 'merchandise')).toBe(false);
  });

  it('is hidden when enabledModules is configured but does not include this key', () => {
    expect(isModuleEnabled({ enabledModules: ['inventory'] }, 'merchandise')).toBe(false);
  });

  it('is shown when enabledModules explicitly includes this key', () => {
    expect(isModuleEnabled({ enabledModules: ['merchandise', 'inventory'] }, 'merchandise')).toBe(true);
  });
});

/**
 * Manors accounting/reports cleanup (2026-10). Opposite polarity from
 * `isModuleEnabled` above: visible by default for every organization,
 * only hidden where explicitly configured (or, for Manors specifically,
 * via the TEMPORARY `MANORS_ORGANIZATION_ID` override — see this file's
 * own comment on why a live Wix field isn't used yet).
 */
describe('isModuleHidden', () => {
  it('is visible by default (false/not-hidden) when the organization has no hiddenModules configured', () => {
    expect(isModuleHidden({ id: 'some-other-org', hiddenModules: undefined }, 'accounting-banking')).toBe(false);
    expect(isModuleHidden({ id: 'some-other-org', hiddenModules: null }, 'accounting-banking')).toBe(false);
    expect(isModuleHidden(null, 'accounting-banking')).toBe(false);
    expect(isModuleHidden(undefined, 'accounting-banking')).toBe(false);
  });

  it('is visible when hiddenModules is configured but does not include this key', () => {
    expect(isModuleHidden({ id: 'some-other-org', hiddenModules: ['reports-staff'] }, 'accounting-banking')).toBe(false);
  });

  it('is hidden when hiddenModules explicitly includes this key', () => {
    expect(isModuleHidden({ id: 'some-other-org', hiddenModules: ['accounting-banking'] }, 'accounting-banking')).toBe(true);
  });

  it('Manors (MANORS_ORGANIZATION_ID) has every HIDEABLE_MODULE_KEYS entry hidden via the override, regardless of its own hiddenModules field', () => {
    for (const key of HIDEABLE_MODULE_KEYS) {
      expect(isModuleHidden({ id: MANORS_ORGANIZATION_ID, hiddenModules: null }, key)).toBe(true);
    }
  });

  it('the Manors override takes priority even if the real hiddenModules field somehow said otherwise', () => {
    expect(isModuleHidden({ id: MANORS_ORGANIZATION_ID, hiddenModules: [] }, 'accounting-chart-of-accounts')).toBe(true);
  });

  it('an unrestricted organization (any id other than Manors, no hiddenModules configured) is completely unaffected — every HIDEABLE_MODULE_KEYS entry stays visible', () => {
    for (const key of HIDEABLE_MODULE_KEYS) {
      expect(isModuleHidden({ id: 'some-other-org', hiddenModules: undefined }, key)).toBe(false);
    }
  });
});
