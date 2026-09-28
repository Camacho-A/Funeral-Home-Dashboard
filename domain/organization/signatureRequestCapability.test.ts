import { describe, expect, it } from 'vitest';
import { isSignatureRequestsEnabled, MANORS_ORGANIZATION_ID } from './signatureRequestCapability';

/**
 * Handwritten item #4 (2026-09, Request Signature removal for Manors).
 */
describe('isSignatureRequestsEnabled', () => {
  it('1: managed-cremations (Manors) resolves to disabled via the override, even with no signatureRequestsEnabled field set', () => {
    expect(isSignatureRequestsEnabled({ id: MANORS_ORGANIZATION_ID, signatureRequestsEnabled: undefined })).toBe(false);
  });

  it('managed-cremations resolves to disabled even if signatureRequestsEnabled were somehow explicitly true (override wins)', () => {
    expect(isSignatureRequestsEnabled({ id: MANORS_ORGANIZATION_ID, signatureRequestsEnabled: true })).toBe(false);
  });

  it('4: another organization with no signatureRequestsEnabled field set preserves existing (enabled) behavior', () => {
    expect(isSignatureRequestsEnabled({ id: 'some-other-org', signatureRequestsEnabled: undefined })).toBe(true);
  });

  it('5: another organization with signatureRequestsEnabled explicitly true is enabled', () => {
    expect(isSignatureRequestsEnabled({ id: 'some-other-org', signatureRequestsEnabled: true })).toBe(true);
  });

  it('another organization with signatureRequestsEnabled explicitly false is disabled — the real field, not just the override, is honored', () => {
    expect(isSignatureRequestsEnabled({ id: 'some-other-org', signatureRequestsEnabled: false })).toBe(false);
  });

  it('8/9: a null/undefined organization (not yet loaded) defaults to enabled — never default-off globally, and this is a separate flag from familyPortalEnabled', () => {
    expect(isSignatureRequestsEnabled(null)).toBe(true);
    expect(isSignatureRequestsEnabled(undefined)).toBe(true);
  });
});
