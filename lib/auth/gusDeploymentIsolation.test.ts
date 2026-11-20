import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures, MANORS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';
import { GUS_ADMIN_IDENTITY_ID, GUS_DIRECTOR_IDENTITY_ID, GUS_VIEWER_IDENTITY_ID } from '@/services/__mocks__/gusFixtures';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

/**
 * Gus deployment isolation (2026-11) — the mirror of
 * manorsDeploymentIsolation.test.ts. The `gus-solis` deployment will run
 * with DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr. Over the real
 * authorization path and fictional data: Gus staff reach Gus with their own
 * role; no Manors account — even one that also belongs to Gus — reaches
 * Manors data through the Gus deployment.
 */

const MANORS = 'managed-cremations';
const GUS = 'gus-camacho-jr';

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(async () => undefined),
  clearSession: vi.fn(),
}));

const { requireAuthorizedOrganization } = await import('./requireAuthorizedOrganization');
const { GET: getMemberships } = await import('@/app/api/auth/memberships/route');
const { createIdentitySession } = await import('@/services/sessionService');
const { createMembership } = await import('@/services/membershipService');

let idCounter = 0;
const idFactory = () => `gus-isolation-${++idCounter}`;

const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER', 'DEPLOYMENT_ORGANIZATION_IDS'] as const;
let originalEnv: Record<string, string | undefined>;
let lengths: { identity: number; membership: number; sessions: number };

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length, sessions: identitySessionFixtures.length };
  mockSession = null;
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
});

async function signInAs(identityId: string) {
  const identity = identityFixtures.find((i) => i.id === identityId);
  if (!identity) throw new Error(`fixture identity ${identityId} missing`);
  const session = await createIdentitySession(
    { identityId, deviceId: 'gus-isolation-device', passwordVersionAtIssue: identity.passwordVersion, idFactory },
    'mock',
  );
  mockSession = {
    user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' },
    sessionId: session.id,
  };
}

async function expectDenied(organizationId: string) {
  const result = await requireAuthorizedOrganization(organizationId);
  expect(result.authorized).toBe(false);
  if (!result.authorized) expect([401, 403]).toContain(result.response.status);
}

describe('Gus deployment (DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr)', () => {
  it("authorizes Gus's own staff for Gus, each with their own role", async () => {
    for (const [identityId, role] of [
      [GUS_ADMIN_IDENTITY_ID, 'administrator'],
      [GUS_DIRECTOR_IDENTITY_ID, 'funeralDirector'],
      [GUS_VIEWER_IDENTITY_ID, 'readOnly'],
    ] as const) {
      await signInAs(identityId);
      const result = await requireAuthorizedOrganization(GUS);
      expect(result.authorized, identityId).toBe(true);
      if (result.authorized) {
        expect(result.context.organizationId).toBe(GUS);
        expect(result.context.role).toBe(role);
      }
    }
  });

  it("refuses Manors' administrator for Manors data (organization not served here)", async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    const result = await requireAuthorizedOrganization(MANORS);
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it("refuses Manors' administrator for Gus data (no Gus membership) and offers no organization", async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    await expectDenied(GUS);
    const body = await (await getMemberships()).json();
    expect(body.organizations ?? []).toEqual([]);
  });

  it('a person who belongs to both tenants reaches only Gus here, and is only offered Gus', async () => {
    await createMembership({ identityId: GUS_ADMIN_IDENTITY_ID, organizationId: MANORS, role: 'administrator', status: 'active', invitedBy: null, idFactory }, 'mock');
    await signInAs(GUS_ADMIN_IDENTITY_ID);
    expect((await requireAuthorizedOrganization(GUS)).authorized).toBe(true);
    await expectDenied(MANORS);
    const body = await (await getMemberships()).json();
    expect(body.organizations.map((o: { organizationId: string }) => o.organizationId)).toEqual([GUS]);
  });

  it('refuses a mock-login session outright once the data is real Wix data', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.AUTH_ADAPTER = 'mock';
    mockSession = { user: mockDefaultUser };
    const result = await requireAuthorizedOrganization(GUS);
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(401);
  });
});
