import { describe, expect, it } from 'vitest';
import { METRIC_REGISTRY, getMetricDefinition } from './metricRegistry';
import { isPermissionKey } from '../rbac/permissionCatalog';

describe('metricRegistry', () => {
  it('has no duplicate metric keys', () => {
    const keys = METRIC_REGISTRY.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every key is a stable dot-namespaced identifier, never the display name', () => {
    for (const m of METRIC_REGISTRY) {
      expect(m.key).toMatch(/^[a-z_]+(\.[a-z0-9_]+)+$/);
      expect(m.key).not.toBe(m.displayName);
    }
  });

  it('every permission referenced is a real catalog key', () => {
    for (const m of METRIC_REGISTRY) {
      expect(isPermissionKey(m.permission)).toBe(true);
    }
  });

  it('every metric names a real service source, not a route or component', () => {
    for (const m of METRIC_REGISTRY) {
      expect(m.source).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
    }
  });

  describe('getMetricDefinition', () => {
    it('resolves a known key', () => {
      expect(getMetricDefinition('cases.active')?.displayName).toBe('Active Cases');
    });

    it('returns undefined for an unknown key', () => {
      expect(getMetricDefinition('cases.bogus')).toBeUndefined();
    });
  });

  it('distinguishes cases.average_cycle_days (true historical duration) from cases.stage.average_days (live snapshot)', () => {
    const cycle = getMetricDefinition('cases.average_cycle_days');
    const snapshot = getMetricDefinition('cases.stage.average_days');
    expect(cycle?.source).not.toBe(snapshot?.source);
  });
});
