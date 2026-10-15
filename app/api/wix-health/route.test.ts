import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '@/types/auth';
import { fixtureIdentitySession } from '@/lib/auth/testing/fixtureIdentityAuth';
import { mockDefaultUser, mockReadOnlyUser } from '@/services/__mocks__/authFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

// Tenant-isolation hardening (2026-10): wix-mode health checks now require
// an identity session with an administrator-tier membership in an
// organization this deployment serves. Sessions are identity sessions for
// authFixtures users (see lib/auth/testing/fixtureIdentityAuth.ts); the
// admin-tier decision is the REAL policy, resolved against the in-memory
// RBAC fixtures (the wix RBAC collections are not what this file tests).
let mockSession: AuthSession | null = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: async () => undefined,
  clearSession: async () => undefined,
}));
vi.mock('@/lib/auth/resolveIdentitySession', async () => (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureResolveIdentitySessionModule);
vi.mock('@/services/membershipService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/membershipService')>()),
  listMembershipsForIdentity: (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureListMembershipsForIdentity,
}));
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/authorizationPolicyService')>();
  return { ...actual, isAdminTier: (params: Parameters<typeof actual.isAdminTier>[0]) => actual.isAdminTier(params, 'mock') };
});

const { GET } = await import('./route');

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID', 'DEPLOYMENT_ORGANIZATION_IDS'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockSession = fixtureIdentitySession(mockDefaultUser, DEFAULT_ORGANIZATION_ID);
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('GET /api/wix-health', () => {
  it('mock mode (the default) responds without attempting any Wix call', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      adapter: 'mock',
      connected: true,
      message: 'Mock mode — no Wix connection required.',
    });
  });

  it('wix mode fails cleanly with a clear message when required config is missing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    // WIX_API_KEY / WIX_SITE_ID deliberately left unset.

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.adapter).toBe('wix');
    expect(body.connected).toBe(false);
    expect(body.error).toMatch(/WIX_API_KEY, WIX_SITE_ID/);
  });

  it('never leaks a raw API key value into the response, even on failure', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'super-secret-test-value';
    // WIX_SITE_ID left unset, so getWixServerConfig() still throws before any
    // network call — this only proves the response body itself is clean.

    const response = await GET();
    const bodyText = await response.text();

    expect(bodyText).not.toContain('super-secret-test-value');
  });

  it('mock mode stays public (nothing site-specific is returned)', async () => {
    mockSession = null;
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it('wix mode: 401 with no session at all, before any Wix call', async () => {
    process.env.DATA_ADAPTER = 'wix';
    mockSession = null;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.text()).not.toMatch(/siteDisplayName|WIX_/);
  });

  it('wix mode: 401 for a mock-source session (mock logins never reach live Wix data)', async () => {
    process.env.DATA_ADAPTER = 'wix';
    mockSession = { user: mockDefaultUser, issuedAt: 0, expiresAt: 0 };
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('wix mode: 403 for an identity session without an administrator-tier role', async () => {
    process.env.DATA_ADAPTER = 'wix';
    mockSession = fixtureIdentitySession(mockReadOnlyUser, DEFAULT_ORGANIZATION_ID);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.text()).not.toMatch(/siteDisplayName|WIX_/);
  });

  it("wix mode: 403 for an administrator whose organization this deployment does not serve", async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    const response = await GET();
    expect(response.status).toBe(403);
  });
});
