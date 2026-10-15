import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingSession } from '@/types/onboarding';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { MANORS_ADMIN_IDENTITY_ID, MANORS_CHRIS_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';

/**
 * Safe onboarding (2026-10). Onboarding access requires an identity session
 * whenever non-identity (mock/Wix-Members) authorization isn't permitted
 * (i.e. on real Wix data), and onboarding sessions for organizations this
 * deployment doesn't serve are never reachable — not even by a platform
 * administrator.
 */
let mockSession: unknown = null;
vi.mock('./session', () => ({ getSession: async () => mockSession }));

const { requirePlatformAdministrator, requireOnboardingSessionAccess } = await import('./requireOnboardingAccess');

const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER', 'PLATFORM_ADMIN_USER_IDS', 'DEPLOYMENT_ORGANIZATION_IDS'] as const;
let savedEnv: Record<string, string | undefined>;

const identityUser = (id: string) => ({ user: { id, email: `${id}@x.test`, displayName: id, source: 'identity' as const, sessionId: 's' } });
const mockUser = (id: string) => ({ user: { id, email: `${id}@x.test`, displayName: id, source: 'mock' as const } });

function onboardingSession(organizationId: string, startedByUserId = 'someone-else'): OnboardingSession {
  const t = '2026-01-01T00:00:00.000Z';
  return {
    id: 'ob-1',
    organizationId,
    status: 'in_progress',
    currentStep: 'organization_profile',
    completedSteps: [],
    startedByUserId,
    startedAt: t,
    completedAt: null,
    lastSavedAt: t,
    version: 1,
    createdAt: t,
    updatedAt: t,
  };
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  mockSession = null;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('requirePlatformAdministrator', () => {
  it('401 without a session', async () => {
    const result = await requirePlatformAdministrator();
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(401);
  });

  it('rejects a non-identity (mock-login) platform admin on Wix data', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.PLATFORM_ADMIN_USER_IDS = 'admin-1';
    mockSession = mockUser('admin-1');
    const result = await requirePlatformAdministrator();
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('accepts an identity-session platform admin on Wix data', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.PLATFORM_ADMIN_USER_IDS = 'admin-1';
    mockSession = identityUser('admin-1');
    expect((await requirePlatformAdministrator()).authorized).toBe(true);
  });

  it('keeps accepting a mock-login platform admin on mock data', async () => {
    process.env.DATA_ADAPTER = 'mock';
    process.env.PLATFORM_ADMIN_USER_IDS = mockDefaultUser.id;
    mockSession = { user: mockDefaultUser };
    expect((await requirePlatformAdministrator()).authorized).toBe(true);
  });

  it('still 403s an identity session that is not a platform admin', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.PLATFORM_ADMIN_USER_IDS = 'admin-1';
    mockSession = identityUser('someone');
    expect((await requirePlatformAdministrator()).authorized).toBe(false);
  });
});

describe('requireOnboardingSessionAccess', () => {
  it("404s an onboarding for an organization outside the deployment allowlist, even for a platform admin", async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.PLATFORM_ADMIN_USER_IDS = 'admin-1';
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    mockSession = identityUser('admin-1');
    const result = await requireOnboardingSessionAccess(onboardingSession('managed-cremations'));
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(404);
  });

  it('allows a platform admin for an allowlisted organization', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.PLATFORM_ADMIN_USER_IDS = 'admin-1';
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    mockSession = identityUser('admin-1');
    expect((await requireOnboardingSessionAccess(onboardingSession('gus-camacho-jr'))).authorized).toBe(true);
  });

  it('rejects a mock-login session on Wix data, even the user who started the onboarding', async () => {
    process.env.DATA_ADAPTER = 'wix';
    mockSession = mockUser('starter');
    const result = await requireOnboardingSessionAccess(onboardingSession('gus-camacho-jr', 'starter'));
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('allows the identity that started the onboarding', async () => {
    process.env.DATA_ADAPTER = 'wix';
    mockSession = identityUser('starter');
    expect((await requireOnboardingSessionAccess(onboardingSession('gus-camacho-jr', 'starter'))).authorized).toBe(true);
  });

  it("allows an identity holding an admin-tier identity membership in the organization; refuses a non-admin member", async () => {
    process.env.DATA_ADAPTER = 'mock';
    mockSession = identityUser(MANORS_ADMIN_IDENTITY_ID);
    expect((await requireOnboardingSessionAccess(onboardingSession('managed-cremations'))).authorized).toBe(true);
    mockSession = identityUser(MANORS_CHRIS_IDENTITY_ID);
    expect((await requireOnboardingSessionAccess(onboardingSession('managed-cremations'))).authorized).toBe(false);
  });
});
