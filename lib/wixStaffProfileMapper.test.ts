import { describe, it, expect } from 'vitest';
import { mapWixStaffProfileItem, buildWixStaffProfileData, applyStaffProfileUpdateToWixData } from './wixStaffProfileMapper';
import type { StaffProfile } from '../types/staffProfile';

const STAFF_PROFILE: StaffProfile = {
  id: 'staff-profile-1',
  organizationId: 'org-1',
  identityId: 'identity-1',
  membershipId: 'membership-1',
  displayName: 'Jane Director',
  role: 'funeral_director',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const NO_MEMBERSHIP_PROFILE: StaffProfile = { ...STAFF_PROFILE, id: 'staff-profile-2', membershipId: null };

describe('wixStaffProfileMapper', () => {
  it('round-trips a profile with a linked membership', () => {
    expect(mapWixStaffProfileItem(buildWixStaffProfileData(STAFF_PROFILE))).toEqual(STAFF_PROFILE);
  });

  it('round-trips a profile with no linked membership (mock/wix auth mode)', () => {
    expect(mapWixStaffProfileItem(buildWixStaffProfileData(NO_MEMBERSHIP_PROFILE))).toEqual(NO_MEMBERSHIP_PROFILE);
  });

  it('returns null for undefined', () => {
    expect(mapWixStaffProfileItem(undefined)).toBeNull();
  });

  it('returns null for an invalid role', () => {
    expect(mapWixStaffProfileItem({ ...buildWixStaffProfileData(STAFF_PROFILE), role: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixStaffProfileItem({ ...buildWixStaffProfileData(STAFF_PROFILE), isActive: 'true' })).toBeNull();
    expect(mapWixStaffProfileItem({ ...buildWixStaffProfileData(STAFF_PROFILE), identityId: undefined })).toBeNull();
  });

  it('applyStaffProfileUpdateToWixData applies only the given patch fields, leaving the rest untouched', () => {
    const wixItem = buildWixStaffProfileData(STAFF_PROFILE);
    const updated = applyStaffProfileUpdateToWixData(wixItem, { isActive: false, updatedAt: '2026-08-15T00:00:00.000Z' });
    expect(updated.isActive).toBe(false);
    expect(updated.displayName).toBe(wixItem.displayName);
    expect(updated.identityId).toBe(wixItem.identityId);
  });
});
