import { describe, expect, it } from 'vitest';
import { buildLaunchChecklist, cloverReadinessLabel, isReadyToLaunch, type LaunchReadinessInput } from './launchReadiness';

const FULLY_READY: LaunchReadinessInput = {
  hasOrganizationProfile: true,
  hasPrimaryLocation: true,
  hasAdministrator: true,
  hasWorkflow: true,
  hasIntakeConfigured: true,
  hasServiceCatalog: true,
  paymentStatusReviewed: true,
  brandingReviewed: true,
};

describe('buildLaunchChecklist / isReadyToLaunch', () => {
  it('is ready when every item is satisfied', () => {
    expect(isReadyToLaunch(FULLY_READY)).toBe(true);
    expect(buildLaunchChecklist(FULLY_READY).every((item) => item.satisfied)).toBe(true);
  });

  it('is not ready when any single item is missing', () => {
    for (const key of Object.keys(FULLY_READY) as Array<keyof LaunchReadinessInput>) {
      const withOneMissing = { ...FULLY_READY, [key]: false };
      expect(isReadyToLaunch(withOneMissing)).toBe(false);
    }
  });

  it('rejects launch when payment status was never reviewed, even though Clover need not be enabled', () => {
    const notReviewed = { ...FULLY_READY, paymentStatusReviewed: false };
    expect(isReadyToLaunch(notReviewed)).toBe(false);
  });

  it('produces the exact eight checklist keys the spec names', () => {
    const keys = buildLaunchChecklist(FULLY_READY).map((item) => item.key);
    expect(keys).toEqual([
      'organization_profile',
      'primary_location',
      'administrator',
      'workflow',
      'intake',
      'service_catalog',
      'payments',
      'branding',
    ]);
  });
});

describe('cloverReadinessLabel', () => {
  it('returns exactly "Clover ready" or "Clover not configured"', () => {
    expect(cloverReadinessLabel(true)).toBe('Clover ready');
    expect(cloverReadinessLabel(false)).toBe('Clover not configured');
  });
});
