import { describe, it, expect } from 'vitest';
import { mapWixPortalSessionItem, buildWixPortalSessionData, applyPortalSessionUpdateToWixData } from './wixPortalSessionMapper';
import type { PortalSession } from '../types/portalSession';

const PORTAL_SESSION: PortalSession = {
  id: 'portal-session-1',
  portalUserId: 'portal-user-1',
  deviceId: 'device-1',
  deviceName: null,
  ipAddress: null,
  userAgent: null,
  expiresAt: '2026-09-01T00:00:00.000Z',
  lastSeenAt: '2026-08-01T00:00:00.000Z',
  revokedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('wixPortalSessionMapper', () => {
  it('round-trips a portal session', () => {
    expect(mapWixPortalSessionItem(buildWixPortalSessionData(PORTAL_SESSION))).toEqual(PORTAL_SESSION);
  });

  it('returns null for undefined', () => {
    expect(mapWixPortalSessionItem(undefined)).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixPortalSessionItem({ ...buildWixPortalSessionData(PORTAL_SESSION), portalUserId: undefined })).toBeNull();
  });

  it('never carries an organizationId, rememberDevice, or passwordVersionAtIssue field — deliberately narrower than IdentitySession', () => {
    const built = buildWixPortalSessionData(PORTAL_SESSION);
    expect('organizationId' in built).toBe(false);
    expect('rememberDevice' in built).toBe(false);
    expect('passwordVersionAtIssue' in built).toBe(false);
  });

  it('applyPortalSessionUpdateToWixData only patches expiresAt/lastSeenAt/revokedAt', () => {
    const existing = buildWixPortalSessionData(PORTAL_SESSION);
    const patched = applyPortalSessionUpdateToWixData(existing, { revokedAt: '2026-08-05T00:00:00.000Z' });
    expect(patched.revokedAt).toBe('2026-08-05T00:00:00.000Z');
    expect(patched.deviceId).toBe(PORTAL_SESSION.deviceId);
  });
});
