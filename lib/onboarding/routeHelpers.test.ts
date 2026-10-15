import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures } from '@/services/__mocks__/onboardingFixtures';
import type { OnboardingSession } from '@/types/onboarding';

vi.mock('@/lib/auth/session', () => ({ getSession: async () => ({ user: mockDefaultUser }) }));

const { resolveOnboardingSessionAccess } = await import('./routeHelpers');

const SESSION: OnboardingSession = {
  id: 'route-helpers-session-other-org',
  organizationId: 'some-other-org',
  status: 'in_progress',
  currentStep: 'organization_profile',
  completedSteps: [],
  startedByUserId: mockDefaultUser.id,
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  lastSavedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let length = 0;
let priorAllowlist: string | undefined;
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  priorAllowlist = process.env.DEPLOYMENT_ORGANIZATION_IDS;
  length = onboardingSessionFixtures.length;
  onboardingSessionFixtures.push({ ...SESSION });
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  onboardingSessionFixtures.length = length;
  if (priorAllowlist === undefined) delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  else process.env.DEPLOYMENT_ORGANIZATION_IDS = priorAllowlist;
});

describe('resolveOnboardingSessionAccess — deployment allowlist (safe onboarding, 2026-10)', () => {
  it('resolves the session on an unrestricted deployment', async () => {
    delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
    const result = await resolveOnboardingSessionAccess(SESSION.id);
    expect(result.ok).toBe(true);
  });

  it("404s a session for an organization this deployment doesn't serve", async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    const result = await resolveOnboardingSessionAccess(SESSION.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });
});
