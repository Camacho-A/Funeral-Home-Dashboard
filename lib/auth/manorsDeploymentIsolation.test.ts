import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures, MANORS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';
import { GUS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/gusFixtures';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

/**
 * Manors multi-tenant compatibility (2026-10). The Manors deployment runs
 * with DEPLOYMENT_ORGANIZATION_IDS=managed-cremations. These tests prove,
 * against the real authorization path over mock data, that a Gus Camacho
 * account — or any account that also belongs to Gus — cannot reach Gus or
 * Manors data through the Manors deployment beyond what Manors itself
 * grants, and that Manors' own staff keep their access.
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
const idFactory = () => `manors-isolation-${++idCounter}`;

const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER', 'DEPLOYMENT_ORGANIZATION_IDS'] as const;
let originalEnv: Record<string, string | undefined>;
let lengths: { identity: number; membership: number; sessions: number };

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.DEPLOYMENT_ORGANIZATION_IDS = MANORS;
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
    { identityId, deviceId: 'manors-isolation-device', passwordVersionAtIssue: identity.passwordVersion, idFactory },
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

describe('Manors deployment (DEPLOYMENT_ORGANIZATION_IDS=managed-cremations)', () => {
  it("still authorizes Manors' own administrator for managed-cremations", async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    const result = await requireAuthorizedOrganization(MANORS);
    expect(result.authorized).toBe(true);
    if (result.authorized) expect(result.context.organizationId).toBe(MANORS);
  });

  it('refuses the Gus administrator for Gus data (organization not served here)', async () => {
    await signInAs(GUS_ADMIN_IDENTITY_ID);
    const result = await requireAuthorizedOrganization(GUS);
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('refuses the Gus administrator for Manors data (no Manors membership)', async () => {
    await signInAs(GUS_ADMIN_IDENTITY_ID);
    await expectDenied(MANORS);
  });

  it('offers the Gus administrator no organization to switch into', async () => {
    await signInAs(GUS_ADMIN_IDENTITY_ID);
    const body = await (await getMemberships()).json();
    expect(body.organizations ?? []).toEqual([]);
  });

  it('a person who belongs to both tenants reaches only Manors here, and is only offered Manors', async () => {
    await createMembership(
      { identityId: MANORS_ADMIN_IDENTITY_ID, organizationId: GUS, role: 'administrator', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    await signInAs(MANORS_ADMIN_IDENTITY_ID);

    expect((await requireAuthorizedOrganization(MANORS)).authorized).toBe(true);
    const gus = await requireAuthorizedOrganization(GUS);
    expect(gus.authorized).toBe(false);
    if (!gus.authorized) expect(gus.response.status).toBe(403);

    const body = await (await getMemberships()).json();
    expect(body.organizations.map((o: { organizationId: string }) => o.organizationId)).toEqual([MANORS]);
  });

  it('refuses a mock-login session outright once the data is real Wix data (no fixture trust)', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.AUTH_ADAPTER = 'mock';
    mockSession = { user: mockDefaultUser };
    const result = await requireAuthorizedOrganization(MANORS);
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(401);
  });
});
