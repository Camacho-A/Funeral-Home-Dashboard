import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreSandboxSession } from './sandboxSessionRestore';
import { identityFixtures, identitySessionFixtures, MANORS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';
import type { AuthSession } from '@/types/auth';
import type { Identity } from '@/types/identity';

/**
 * SOLIS sandbox (2026-10): a signed-in tester stays the same person when a
 * fresh server instance has no record of their session — sandbox only.
 */

const identity = () => identityFixtures.find((i) => i.id === MANORS_ADMIN_IDENTITY_ID) as unknown as Identity;
const session = (overrides: Partial<AuthSession> = {}): AuthSession =>
  ({ user: { id: MANORS_ADMIN_IDENTITY_ID, email: 'dana@managedcremations.test', displayName: 'Dana', source: 'identity' }, sessionId: 'signed-session-1', ...overrides }) as AuthSession;

let sessionsBefore = 0;
beforeEach(() => {
  sessionsBefore = identitySessionFixtures.length;
  vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', 'true');
  vi.stubEnv('DATA_ADAPTER', 'mock');
  vi.stubEnv('AUTH_ADAPTER', 'identity');
  vi.stubEnv('DEPLOYMENT_ORGANIZATION_IDS', 'managed-cremations');
});
afterEach(() => {
  vi.unstubAllEnvs();
  identitySessionFixtures.length = sessionsBefore;
});

describe('restoreSandboxSession', () => {
  it('re-creates the signed session for the same identity, in the sandbox organization', () => {
    const restored = restoreSandboxSession(session(), identity(), 'mock')!;
    expect(restored).toMatchObject({ id: 'signed-session-1', identityId: MANORS_ADMIN_IDENTITY_ID, organizationId: 'managed-cremations', revokedAt: null });
    expect(restored.passwordVersionAtIssue).toBe(identity().passwordVersion);
    expect(identitySessionFixtures.at(-1)).toBe(restored);
  });

  it('never outside the sandbox', () => {
    vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', '');
    expect(restoreSandboxSession(session(), identity(), 'mock')).toBeNull();
  });

  it('never with real data', () => {
    expect(restoreSandboxSession(session(), identity(), 'wix')).toBeNull();
  });

  it('never when the sandbox is not isolated (a live credential is present)', () => {
    vi.stubEnv('WIX_API_KEY', 'something');
    expect(restoreSandboxSession(session(), identity(), 'mock')).toBeNull();
  });

  it('never for a cookie naming a different or inactive identity, or with no session id', () => {
    expect(restoreSandboxSession(session({ user: { id: 'someone-else', email: 'x@example.test', displayName: 'X', source: 'identity' } } as never), identity(), 'mock')).toBeNull();
    expect(restoreSandboxSession(session(), { ...identity(), status: 'disabled' } as Identity, 'mock')).toBeNull();
    expect(restoreSandboxSession(session(), null, 'mock')).toBeNull();
    expect(restoreSandboxSession(session({ sessionId: undefined }), identity(), 'mock')).toBeNull();
    expect(identitySessionFixtures.length).toBe(sessionsBefore);
  });
});
