import { describe, expect, it } from 'vitest';
import { isModuleEnabled } from './moduleVisibility';

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
