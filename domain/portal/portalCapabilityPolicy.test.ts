import { describe, expect, it } from 'vitest';
import { PORTAL_CAPABILITY_KEYS, PORTAL_CAPABILITY_LABELS, hasPortalCapability, isValidPortalCapabilityKey } from './portalCapabilityPolicy';
import type { PortalAccess } from '../../types/portalAccess';

function makeAccess(overrides: Partial<PortalAccess> = {}): PortalAccess {
  return {
    id: 'access-1',
    portalUserId: 'portal-user-1',
    organizationId: 'org-1',
    caseId: 'case-1',
    relationshipType: 'primary_next_of_kin',
    status: 'active',
    grantedFromInvitationId: 'invitation-1',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('PORTAL_CAPABILITY_KEYS / PORTAL_CAPABILITY_LABELS', () => {
  it('every capability key has a distinct, non-derived label', () => {
    for (const key of PORTAL_CAPABILITY_KEYS) {
      expect(PORTAL_CAPABILITY_LABELS[key]).toBeDefined();
      expect(PORTAL_CAPABILITY_LABELS[key]).not.toBe(key);
    }
  });

  it('includes exactly the eleven keys named in the approved plan', () => {
    expect([...PORTAL_CAPABILITY_KEYS].sort()).toEqual(
      [
        'case.summary.read',
        'case.timeline.read',
        'document.read',
        'document.download',
        'signature.complete',
        'payment.read',
        'payment.pay',
        'appointment.read',
        'notification.read',
        'message.read',
        'message.send',
      ].sort(),
    );
  });
});

describe('isValidPortalCapabilityKey', () => {
  it('accepts every registered key and rejects a made-up one', () => {
    for (const key of PORTAL_CAPABILITY_KEYS) expect(isValidPortalCapabilityKey(key)).toBe(true);
    expect(isValidPortalCapabilityKey('case.delete')).toBe(false);
  });
});

describe('hasPortalCapability', () => {
  it('primary_next_of_kin and executor get every capability, including payment.pay', () => {
    expect(hasPortalCapability(makeAccess({ relationshipType: 'primary_next_of_kin' }), 'payment.pay')).toBe(true);
    expect(hasPortalCapability(makeAccess({ relationshipType: 'executor' }), 'payment.pay')).toBe(true);
  });

  it('secondary_family_member and authorized_representative get everything except payment.pay', () => {
    for (const relationshipType of ['secondary_family_member', 'authorized_representative'] as const) {
      const access = makeAccess({ relationshipType });
      expect(hasPortalCapability(access, 'payment.pay')).toBe(false);
      expect(hasPortalCapability(access, 'payment.read')).toBe(true);
      expect(hasPortalCapability(access, 'document.read')).toBe(true);
      expect(hasPortalCapability(access, 'signature.complete')).toBe(true);
    }
  });

  it('reserved relationship types grant zero capabilities', () => {
    for (const relationshipType of ['attorney', 'insurance_adjuster', 'veteran_representative', 'church_representative', 'funeral_home_partner'] as const) {
      const access = makeAccess({ relationshipType });
      for (const key of PORTAL_CAPABILITY_KEYS) {
        expect(hasPortalCapability(access, key)).toBe(false);
      }
    }
  });

  it('fails closed for every non-active status, regardless of relationship type', () => {
    for (const status of ['pending', 'disabled', 'revoked', 'expired'] as const) {
      const access = makeAccess({ relationshipType: 'primary_next_of_kin', status });
      expect(hasPortalCapability(access, 'document.read')).toBe(false);
    }
  });
});
