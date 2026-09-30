import { describe, expect, it } from 'vitest';
import { shouldShowCaseOwner } from './caseOwnerVisibility';

describe('shouldShowCaseOwner (Task #17, 2026-09)', () => {
  it('returns false for managed-cremations (Manors)', () => {
    expect(shouldShowCaseOwner('managed-cremations')).toBe(false);
  });

  it('returns true for any other organization', () => {
    expect(shouldShowCaseOwner('some-other-org')).toBe(true);
    expect(shouldShowCaseOwner('second-mock-organization')).toBe(true);
  });
});
