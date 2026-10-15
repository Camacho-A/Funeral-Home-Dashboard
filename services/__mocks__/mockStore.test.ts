import { describe, expect, it, vi } from 'vitest';
import { mockCollection, resetMockStore, hasMockCollection } from './mockStore';

describe('mockCollection', () => {
  it('returns the same instance for the same key, initializing once', () => {
    const init = vi.fn(() => [1, 2, 3]);
    const first = mockCollection('test:same-instance', init);
    const second = mockCollection('test:same-instance', init);

    expect(second).toBe(first);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('supports Maps as well as arrays', () => {
    const map = mockCollection('test:map', () => new Map<string, number>());
    map.set('a', 1);
    expect(mockCollection('test:map', () => new Map<string, number>()).get('a')).toBe(1);
  });

  it('resetMockStore drops a key so the next access re-initializes it', () => {
    mockCollection('test:reset', () => ['old']).push('mutated');
    resetMockStore(['test:reset']);

    expect(hasMockCollection('test:reset')).toBe(false);
    expect(mockCollection('test:reset', () => ['fresh'])).toEqual(['fresh']);
  });
});

describe('mock identity state survives fresh module instances (next dev server-action vs. RSC render)', () => {
  it('a session created through one module instance is found through a freshly imported one', async () => {
    const first = await import('../sessionService');
    const created = await first.createIdentitySession(
      { identityId: 'identity-gus-admin', deviceId: 'device-1', passwordVersionAtIssue: 1, idFactory: () => 'persisted-session-id' },
      'mock',
    );

    vi.resetModules();
    const second = await import('../sessionService');
    expect(second).not.toBe(first);

    const found = await second.getSessionById(created.id, 'mock');
    expect(found?.identityId).toBe('identity-gus-admin');
  });

  it('identity, membership and RBAC fixture arrays are the same instances across module instances', async () => {
    const identityA = await import('./identityFixtures');
    const rbacA = await import('./rbacFixtures');
    const casesA = await import('./fixtures');
    vi.resetModules();
    const identityB = await import('./identityFixtures');
    const rbacB = await import('./rbacFixtures');
    const casesB = await import('./fixtures');

    expect(identityB).not.toBe(identityA);
    expect(identityB.identityFixtures).toBe(identityA.identityFixtures);
    expect(identityB.membershipFixtures).toBe(identityA.membershipFixtures);
    expect(identityB.passwordResetTokenFixtures).toBe(identityA.passwordResetTokenFixtures);
    expect(identityB.emailVerificationTokenFixtures).toBe(identityA.emailVerificationTokenFixtures);
    expect(rbacB.roleFixtures).toBe(rbacA.roleFixtures);
    expect(rbacB.rolePermissionFixtures).toBe(rbacA.rolePermissionFixtures);
    expect(rbacB.organizationRolePermissionOverrideFixtures).toBe(rbacA.organizationRolePermissionOverrideFixtures);
    expect(casesB.caseFixtures).toBe(casesA.caseFixtures);
  });
});
