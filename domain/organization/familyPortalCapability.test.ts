import { describe, expect, it } from 'vitest';
import { isFamilyPortalEnabled, MANORS_ORGANIZATION_ID } from './familyPortalCapability';

/**
 * Handwritten item #3 (2026-09, Family Portal removal for Manors).
 */
describe('isFamilyPortalEnabled', () => {
  it('1: managed-cremations (Manors) resolves to disabled via the override, even with no familyPortalEnabled field set', () => {
    expect(isFamilyPortalEnabled({ id: MANORS_ORGANIZATION_ID, familyPortalEnabled: undefined })).toBe(false);
  });

  it('managed-cremations resolves to disabled even if familyPortalEnabled were somehow explicitly true (override wins)', () => {
    expect(isFamilyPortalEnabled({ id: MANORS_ORGANIZATION_ID, familyPortalEnabled: true })).toBe(false);
  });

  it('7: another organization with no familyPortalEnabled field set preserves existing (enabled) behavior', () => {
    expect(isFamilyPortalEnabled({ id: 'some-other-org', familyPortalEnabled: undefined })).toBe(true);
  });

  it('another organization with familyPortalEnabled explicitly true is enabled', () => {
    expect(isFamilyPortalEnabled({ id: 'some-other-org', familyPortalEnabled: true })).toBe(true);
  });

  it('another organization with familyPortalEnabled explicitly false is disabled — the real field, not just the override, is honored', () => {
    expect(isFamilyPortalEnabled({ id: 'some-other-org', familyPortalEnabled: false })).toBe(false);
  });

  it('a null/undefined organization (not yet loaded) defaults to enabled — never default-off globally', () => {
    expect(isFamilyPortalEnabled(null)).toBe(true);
    expect(isFamilyPortalEnabled(undefined)).toBe(true);
  });
});
