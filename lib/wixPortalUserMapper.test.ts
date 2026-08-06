import { describe, it, expect } from 'vitest';
import { mapWixPortalUserItem, buildWixPortalUserData, applyPortalUserUpdateToWixData } from './wixPortalUserMapper';
import type { PortalUser } from '../types/portalUser';

const PORTAL_USER: PortalUser = {
  id: 'portal-user-1',
  email: 'family@example.com',
  normalizedEmail: 'family@example.com',
  displayName: 'Pat Family',
  passwordHash: 'salt:derived',
  emailVerified: false,
  status: 'active',
  passwordResetTokenHash: null,
  passwordResetExpiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('wixPortalUserMapper', () => {
  it('round-trips a portal user', () => {
    expect(mapWixPortalUserItem(buildWixPortalUserData(PORTAL_USER))).toEqual(PORTAL_USER);
  });

  it('returns null for undefined', () => {
    expect(mapWixPortalUserItem(undefined)).toBeNull();
  });

  it('returns null for an invalid status', () => {
    expect(mapWixPortalUserItem({ ...buildWixPortalUserData(PORTAL_USER), status: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixPortalUserItem({ ...buildWixPortalUserData(PORTAL_USER), passwordHash: undefined })).toBeNull();
  });

  it('applyPortalUserUpdateToWixData only patches provided fields', () => {
    const existing = buildWixPortalUserData(PORTAL_USER);
    const patched = applyPortalUserUpdateToWixData(existing, { status: 'disabled' });
    expect(patched.status).toBe('disabled');
    expect(patched.email).toBe(PORTAL_USER.email);
    expect(patched.passwordHash).toBe(PORTAL_USER.passwordHash);
  });

  it('applyPortalUserUpdateToWixData can update passwordResetTokenHash/Expiry', () => {
    const existing = buildWixPortalUserData(PORTAL_USER);
    const patched = applyPortalUserUpdateToWixData(existing, {
      passwordResetTokenHash: 'a-hash',
      passwordResetExpiresAt: '2026-08-02T00:00:00.000Z',
    });
    expect(patched.passwordResetTokenHash).toBe('a-hash');
    expect(patched.passwordResetExpiresAt).toBe('2026-08-02T00:00:00.000Z');
  });
});
