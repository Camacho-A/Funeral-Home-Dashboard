import { describe, expect, it } from 'vitest';
import { REPORT_REGISTRY, getReportDefinition, listReportDefinitionsForPermissions, isReportVisibleForOrganization } from './reportRegistry';
import { getMetricDefinition } from './metricRegistry';
import { isPermissionKey } from '../rbac/permissionCatalog';
import { MANORS_ORGANIZATION_ID } from '../organization/moduleVisibility';

describe('reportRegistry', () => {
  it('has no duplicate report keys', () => {
    const keys = REPORT_REGISTRY.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every metric referenced by a report exists in the metric registry', () => {
    for (const r of REPORT_REGISTRY) {
      for (const metricKey of r.metrics) {
        expect(getMetricDefinition(metricKey)).toBeDefined();
      }
    }
  });

  it('every permission referenced is a real catalog key', () => {
    for (const r of REPORT_REGISTRY) {
      expect(isPermissionKey(r.permission)).toBe(true);
    }
  });

  it('a report either lists metrics or delegates to a Phase 31 financial report function, never neither', () => {
    for (const r of REPORT_REGISTRY) {
      expect(r.metrics.length > 0 || r.financialReportKey !== undefined).toBe(true);
    }
  });

  it('the 6 Phase 31 financial report functions (5 core reports + AR aging) are registered by financialReportKey, not duplicated as metric lists', () => {
    const financialKeys = REPORT_REGISTRY.filter((r) => r.financialReportKey).map((r) => r.financialReportKey);
    expect(new Set(financialKeys)).toEqual(new Set(['generalLedgerDetail', 'trialBalance', 'profitAndLoss', 'balanceSheet', 'transactionRegister', 'arAging']));
  });

  it('the Veteran Case Status report from the pre-Phase-32 Reports page is preserved', () => {
    expect(getReportDefinition('va-case-status')).toBeDefined();
  });

  describe('getReportDefinition', () => {
    it('resolves a known key', () => {
      expect(getReportDefinition('active-cases')?.category).toBe('operational');
    });

    it('returns undefined for an unknown key', () => {
      expect(getReportDefinition('bogus-report')).toBeUndefined();
    });
  });

  describe('listReportDefinitionsForPermissions', () => {
    it('filters to only reports the caller has permission for', () => {
      const visible = listReportDefinitionsForPermissions(new Set(['report.operational']));
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every((r) => r.permission === 'report.operational')).toBe(true);
    });

    it('returns nothing for an empty permission set', () => {
      expect(listReportDefinitionsForPermissions(new Set())).toEqual([]);
    });
  });

  /**
   * Manors accounting/reports cleanup (2026-10). Definitions themselves
   * are never removed — every key still resolves via `getReportDefinition`
   * regardless of visibility. `isReportVisibleForOrganization` is the one
   * function every report-serving route (list/view/export) calls.
   */
  describe('isReportVisibleForOrganization', () => {
    const staffReport = getReportDefinition('case-ownership')!;
    const documentsReport = getReportDefinition('outstanding-signatures')!;
    const operationalReport = getReportDefinition('active-cases')!;
    const financialReport = getReportDefinition('trial-balance')!;
    const MANORS = { id: MANORS_ORGANIZATION_ID, enabledModules: null, hiddenModules: null };
    const OTHER_ORG = { id: 'some-other-org', enabledModules: null, hiddenModules: null };

    it('a Staff-category report is NOT visible for Manors', () => {
      expect(isReportVisibleForOrganization(staffReport, MANORS)).toBe(false);
    });

    it('a Documents-category report is NOT visible for Manors', () => {
      expect(isReportVisibleForOrganization(documentsReport, MANORS)).toBe(false);
    });

    it('Operational and Financial reports remain visible for Manors', () => {
      expect(isReportVisibleForOrganization(operationalReport, MANORS)).toBe(true);
      expect(isReportVisibleForOrganization(financialReport, MANORS)).toBe(true);
    });

    it('every report definition still exists — this never deletes anything, only filters display', () => {
      expect(getReportDefinition('case-ownership')).toBeDefined();
      expect(getReportDefinition('outstanding-signatures')).toBeDefined();
    });

    it('an unrestricted organization sees Staff and Documents reports exactly as before', () => {
      expect(isReportVisibleForOrganization(staffReport, OTHER_ORG)).toBe(true);
      expect(isReportVisibleForOrganization(documentsReport, OTHER_ORG)).toBe(true);
    });

    it('still respects the pre-existing requiresModule gate independently of category hiding', () => {
      const merchandiseReport = getReportDefinition('merchandise-performance')!;
      expect(isReportVisibleForOrganization(merchandiseReport, { id: 'any-org', enabledModules: null, hiddenModules: null })).toBe(false);
      expect(isReportVisibleForOrganization(merchandiseReport, { id: 'any-org', enabledModules: ['merchandise'], hiddenModules: null })).toBe(true);
    });

    it('a null/undefined organization never hides a category-gated report — only requiresModule can hide it in that case', () => {
      expect(isReportVisibleForOrganization(staffReport, null)).toBe(true);
      expect(isReportVisibleForOrganization(documentsReport, undefined)).toBe(true);
    });
  });
});
