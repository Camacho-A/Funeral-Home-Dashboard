import { describe, expect, it } from 'vitest';
import { isDocumentArchivingEnabled, MANORS_ORGANIZATION_ID } from './documentArchiveCapability';

/**
 * Handwritten item #12 (2026-09, document Archive removal for Manors).
 */
describe('isDocumentArchivingEnabled', () => {
  it('1: managed-cremations (Manors) resolves to disabled via the override', () => {
    expect(isDocumentArchivingEnabled(MANORS_ORGANIZATION_ID)).toBe(false);
  });

  it('8/9: another organization defaults to enabled (existing behavior preserved)', () => {
    expect(isDocumentArchivingEnabled('some-other-org')).toBe(true);
  });

  it('a null/undefined organizationId (not yet loaded) defaults to enabled — never default-off globally', () => {
    expect(isDocumentArchivingEnabled(null)).toBe(true);
    expect(isDocumentArchivingEnabled(undefined)).toBe(true);
  });
});
