import { describe, it, expect } from 'vitest';
import { isValidPickupReleaseDetail, assertValidPickupReleasePatch, PICKUP_RELEASE_VALIDATION_ERROR } from './pickupRelease';

describe('isValidPickupReleaseDetail', () => {
  it('is valid when both Released to and a valid Released date are present', () => {
    expect(isValidPickupReleaseDetail('Karen Ellison', '07/10/2026')).toBe(true);
  });

  it('is invalid when Released to is null or blank', () => {
    expect(isValidPickupReleaseDetail(null, '07/10/2026')).toBe(false);
    expect(isValidPickupReleaseDetail('   ', '07/10/2026')).toBe(false);
  });

  it('is invalid when Released date is null or blank — unlike isValidCalendarDate, blank is never valid here', () => {
    expect(isValidPickupReleaseDetail('Karen Ellison', null)).toBe(false);
    expect(isValidPickupReleaseDetail('Karen Ellison', '')).toBe(false);
  });

  it('is invalid when Released date is not a real calendar date', () => {
    expect(isValidPickupReleaseDetail('Karen Ellison', '13/40/2026')).toBe(false);
  });

  it('is invalid when both are missing', () => {
    expect(isValidPickupReleaseDetail(null, null)).toBe(false);
  });
});

describe('assertValidPickupReleasePatch', () => {
  const awaitingExisting = { pickupStatus: 'awaiting_pickup' as const, pickupReleasedTo: null, pickupReleasedAt: null };
  const releasedExisting = { pickupStatus: 'released' as const, pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' };

  it('passes for a patch that never touches pickupStatus or the detail fields', () => {
    expect(() => assertValidPickupReleasePatch(awaitingExisting, { pickupReleasedTo: undefined })).not.toThrow();
    expect(() => assertValidPickupReleasePatch(awaitingExisting, {})).not.toThrow();
  });

  it('passes when reverting to awaiting_pickup, regardless of the detail fields in the same patch', () => {
    expect(() => assertValidPickupReleasePatch(releasedExisting, { pickupStatus: 'awaiting_pickup' })).not.toThrow();
    expect(() =>
      assertValidPickupReleasePatch(releasedExisting, { pickupStatus: 'awaiting_pickup', pickupReleasedTo: null, pickupReleasedAt: null }),
    ).not.toThrow();
  });

  it('throws when a patch would transition to released without a valid Released to/Released date', () => {
    expect(() => assertValidPickupReleasePatch(awaitingExisting, { pickupStatus: 'released' })).toThrow(PICKUP_RELEASE_VALIDATION_ERROR);
  });

  it('passes when a patch transitions to released with both detail fields supplied in the same patch', () => {
    expect(() =>
      assertValidPickupReleasePatch(awaitingExisting, { pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' }),
    ).not.toThrow();
  });

  it('passes when transitioning to released and the detail fields were already valid on the existing record', () => {
    const existingWithDetails = { pickupStatus: 'awaiting_pickup' as const, pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' };
    expect(() => assertValidPickupReleasePatch(existingWithDetails, { pickupStatus: 'released' })).not.toThrow();
  });

  it('throws when an already-released case would have Released to cleared to blank, even without pickupStatus in the patch', () => {
    expect(() => assertValidPickupReleasePatch(releasedExisting, { pickupReleasedTo: null })).toThrow(PICKUP_RELEASE_VALIDATION_ERROR);
  });

  it('throws when an already-released case would have Released date cleared to blank', () => {
    expect(() => assertValidPickupReleasePatch(releasedExisting, { pickupReleasedAt: null })).toThrow(PICKUP_RELEASE_VALIDATION_ERROR);
  });

  it('passes when an already-released case has its Released to/Released date edited to another valid value', () => {
    expect(() => assertValidPickupReleasePatch(releasedExisting, { pickupReleasedTo: 'Someone Else' })).not.toThrow();
  });

  it('is unaffected by pickupNote — optional, never part of the check', () => {
    expect(() => assertValidPickupReleasePatch(awaitingExisting, { pickupStatus: 'released' })).toThrow();
    expect(() =>
      assertValidPickupReleasePatch(awaitingExisting, { pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' }),
    ).not.toThrow();
  });
});
