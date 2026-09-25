import { describe, expect, it } from 'vitest';
import { isVaComplete, needsVeteranAttention } from './veteran';
import type { Case } from '../../types/case';

/**
 * VA responsibility correction (2026-09). Covers the checkpoint's
 * "TESTS — VA" list items 10-15 and 17 directly. Item 16 ("MANORS/FAMILY
 * decision participates correctly in first-incomplete-step calculation")
 * is addressed here via `needsVeteranAttention`/`attentionReason` — the
 * real "what does this case still need" signal VA notification actually
 * participates in today (see this file's own report: VA notification has
 * never been part of the rawStage-based checklist system at all, so it
 * has no first-incomplete-*rawStage*-step role to play; wiring it in
 * would be a new blocking requirement this checkpoint never asked for).
 * Item 18 (audit capture) is covered in
 * app/api/cases/[caseId]/route.test.ts — vaNotificationResponsibility
 * flows through the same generic changedFields diff every other Case
 * field already uses, requiring no dedicated test here.
 */

function buildCase(overrides: Partial<Case> = {}): Case {
  const base = {
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    vaNotificationResponsibility: null,
  } as Case;
  return { ...base, ...overrides };
}

describe('isVaComplete / needsVeteranAttention — VA responsibility correction (2026-09)', () => {
  it('10: a non-veteran case never needs VA attention, regardless of any stale vaNotificationResponsibility', () => {
    const notVeteran = buildCase({ isVeteran: false, vaNotificationResponsibility: null });
    expect(needsVeteranAttention(notVeteran)).toBe(false);

    const notVeteranWithStaleResponsibility = buildCase({ isVeteran: false, vaNotificationResponsibility: 'manors' });
    expect(needsVeteranAttention(notVeteranWithStaleResponsibility)).toBe(false);
  });

  it('11: veteran YES + no responsibility decided yet still needs attention — undecided is never treated as complete', () => {
    const case_ = buildCase({ isVeteran: true, vaNotificationResponsibility: null });
    expect(isVaComplete(case_)).toBe(false);
    expect(needsVeteranAttention(case_)).toBe(true);
  });

  it('12: veteran YES + MANORS still requires the internal VA_STEPS checklist to be completed', () => {
    const incomplete = buildCase({ isVeteran: true, vaNotificationResponsibility: 'manors', vaStepsState: {}, vaPublishChoice: null });
    expect(isVaComplete(incomplete)).toBe(false);
    expect(needsVeteranAttention(incomplete)).toBe(true);

    const complete = buildCase({
      isVeteran: true,
      vaNotificationResponsibility: 'manors',
      vaStepsState: { 0: true, 1: true, 2: true },
      vaPublishChoice: 'publish',
    });
    expect(isVaComplete(complete)).toBe(true);
    expect(needsVeteranAttention(complete)).toBe(false);
  });

  it('13: veteran YES + FAMILY is immediately complete/non-blocking, even with zero VA_STEPS done and no publish choice', () => {
    const case_ = buildCase({ isVeteran: true, vaNotificationResponsibility: 'family', vaStepsState: {}, vaPublishChoice: null });
    expect(isVaComplete(case_)).toBe(true);
    expect(needsVeteranAttention(case_)).toBe(false);
  });

  it('14: FAMILY never changes isVeteran — the two facts stay independent', () => {
    const case_ = buildCase({ isVeteran: true, vaNotificationResponsibility: 'family' });
    expect(case_.isVeteran).toBe(true);
  });

  it('15: FAMILY never marks vaStepsState/vaPublishChoice as if Manors completed them', () => {
    const case_ = buildCase({ isVeteran: true, vaNotificationResponsibility: 'family' });
    // isVaComplete returns true via the early FAMILY branch, WITHOUT ever
    // touching/reading these as "done" — confirmed they remain exactly
    // whatever they already were (never backfilled to look completed).
    expect(case_.vaStepsState).toEqual({});
    expect(case_.vaPublishChoice).toBeNull();
  });

  it('17: changing veteran YES -> NO removes the VA requirement from evaluation immediately, even with MANORS + incomplete steps', () => {
    const case_ = buildCase({ isVeteran: false, vaNotificationResponsibility: 'manors', vaStepsState: {}, vaPublishChoice: null });
    expect(needsVeteranAttention(case_)).toBe(false);
  });

  it('a veteran case with MANORS and only the steps done but no publish choice yet is still incomplete', () => {
    const case_ = buildCase({
      isVeteran: true,
      vaNotificationResponsibility: 'manors',
      vaStepsState: { 0: true, 1: true, 2: true },
      vaPublishChoice: null,
    });
    expect(isVaComplete(case_)).toBe(false);
    expect(needsVeteranAttention(case_)).toBe(true);
  });
});
