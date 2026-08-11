import { describe, expect, it } from 'vitest';
import { REPORT_REGISTRY, getReportDefinition, listReportDefinitionsForPermissions } from './reportRegistry';
import { getMetricDefinition } from './metricRegistry';
import { isPermissionKey } from '../rbac/permissionCatalog';

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
});
