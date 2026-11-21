import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures, MANORS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';
import { staffFixtures, caseFixtures } from '@/services/__mocks__/fixtures';
import { GUS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/gusFixtures';
import {
  buildDualOrganizationIdentities,
  buildDualOrganizationMemberships,
  buildDualOrganizationStaff,
  CASEY_DUAL_IDENTITY_ID,
  ROBIN_DUAL_IDENTITY_ID,
} from '@/services/__mocks__/dualOrganizationFixtures';

/**
 * Unified portal (Phase 5N). One deployment serving Gus AND Manors
 * (DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr,managed-cremations), over the
 * real authorization path and fictional data:
 *  - a person in both organizations reaches both, each with THAT
 *    organization's role and permissions, without signing in twice;
 *  - a person in one organization never reaches the other — whatever their
 *    role at home;
 *  - an organization named in an address or request is checked against the
 *    person's own membership; "all" is never an organization;
 *  - a historical organization opens no new cases.
 */
const MANORS = 'managed-cremations';
const GUS = 'gus-camacho-jr';

const state = vi.hoisted(() => ({ session: null as unknown, historical: null as string | null }));
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: async () => state.session,
  createSession: vi.fn(async () => undefined),
  clearSession: vi.fn(),
}));
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/organization/organizationProfiles')>();
  return {
    ...actual,
    getRegisteredOrganizationProfile: (organizationId: string) => {
      const profile = actual.getRegisteredOrganizationProfile(organizationId);
      return organizationId === state.historical ? { ...profile, features: { ...profile.features, transitionStatus: 'historical' as const } } : profile;
    },
  };
});

const { requireAuthorizedOrganization } = await import('./requireAuthorizedOrganization');
const { alignSessionOrganization } = await import('./alignSessionOrganization');
const { GET: getMemberships } = await import('@/app/api/auth/memberships/route');
const casesRoute = await import('@/app/api/cases/route');
const caseRoute = await import('@/app/api/cases/[caseId]/route');
const { createIdentitySession, getSessionById } = await import('@/services/sessionService');
const { resolvePermissions } = await import('@/services/permissionService');
const { organizationAcceptsNewCases } = await import('@/domain/organization/organizationTransition');
const { POST: issueSetupCode } = await import('@/app/api/auth/mfa/setup-grants/route');
const { updateIdentity } = await import('@/services/identityService');
const { portalMfaSetupGrantFixtures } = await import('@/services/portalMfaStore');

let idCounter = 0;
const idFactory = () => `unified-${++idCounter}`;
const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER', 'DEPLOYMENT_ORGANIZATION_IDS'] as const;
let originalEnv: Record<string, string | undefined>;
let lengths: { identity: number; membership: number; sessions: number; staff: number };
let currentSessionId = '';

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.DEPLOYMENT_ORGANIZATION_IDS = `${GUS},${MANORS}`;
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length, sessions: identitySessionFixtures.length, staff: staffFixtures.length };
  identityFixtures.push(...(buildDualOrganizationIdentities() as never[]));
  membershipFixtures.push(...buildDualOrganizationMemberships());
  staffFixtures.push(...buildDualOrganizationStaff());
  state.session = null;
  state.historical = null;
});

afterEach(() => {
  ENV_KEYS.forEach((key) => (originalEnv[key] === undefined ? delete process.env[key] : (process.env[key] = originalEnv[key])));
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  staffFixtures.length = lengths.staff;
});

async function signInAs(identityId: string) {
  const identity = identityFixtures.find((i) => i.id === identityId)!;
  const session = await createIdentitySession({ identityId, deviceId: 'unified-device', passwordVersionAtIssue: identity.passwordVersion, idFactory }, 'mock');
  currentSessionId = session.id;
  state.session = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
}
const roleIn = async (organizationId: string) => {
  const result = await requireAuthorizedOrganization(organizationId);
  return result.authorized ? result.context.role : result.response.status;
};
const perms = (organizationId: string, roleKey: string) => resolvePermissions({ identityId: 'x', organizationId, roleKey }, 'mock');
const json = (body: unknown) => new Request('http://localhost/api/cases', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('dual-organization staff: one sign-in, each organization on its own terms', () => {
  it('Casey reaches Gus as Manager and Manors as Office Staff, in the same session', async () => {
    await signInAs(CASEY_DUAL_IDENTITY_ID);
    expect(await roleIn(GUS)).toBe('manager');
    expect(await roleIn(MANORS)).toBe('officeStaff');
    const gus = await perms(GUS, 'manager');
    const manors = await perms(MANORS, 'officeStaff');
    expect(gus.has('user.invite')).toBe(true);
    expect(manors.has('user.invite')).toBe(false); // a Gus role grants nothing at Manors
    const body = await (await getMemberships()).json();
    expect(body.organizations.map((o: { organizationId: string }) => o.organizationId).sort()).toEqual([GUS, MANORS].sort());
  });

  it('Robin: Manors Funeral Director may change cases there; Gus Read Only may not', async () => {
    await signInAs(ROBIN_DUAL_IDENTITY_ID);
    expect(await roleIn(MANORS)).toBe('funeralDirector');
    expect(await roleIn(GUS)).toBe('readOnly');
    expect((await perms(MANORS, 'funeralDirector')).has('case.update')).toBe(true);
    expect((await perms(GUS, 'readOnly')).has('case.update')).toBe(false);
  });
});

describe('single-organization staff never reach the other organization', () => {
  it('the Gus administrator: Gus yes, Manors refused (403), offered only Gus', async () => {
    await signInAs(GUS_ADMIN_IDENTITY_ID);
    expect(await roleIn(GUS)).toBe('administrator');
    expect(await roleIn(MANORS)).toBe(403);
    const body = await (await getMemberships()).json();
    expect(body.organizations.map((o: { organizationId: string }) => o.organizationId)).toEqual([GUS]);
  });

  it("Manors' administrator: Manors yes, Gus refused (403)", async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    expect(await roleIn(MANORS)).toBe('administrator');
    expect(await roleIn(GUS)).toBe(403);
  });

  it('"all", or any organization outside the person\'s memberships, is never an organization', async () => {
    await signInAs(CASEY_DUAL_IDENTITY_ID);
    for (const id of ['all', 'evergreen-memorial-group', `${GUS},${MANORS}`, '*']) expect(await roleIn(id), id).toBe(403);
  });
});

describe('organization-specific case addresses (/o/{organization}/cases/{id})', () => {
  it('switches the working organization only after checking the membership; never for an outsider', async () => {
    await signInAs(CASEY_DUAL_IDENTITY_ID);
    expect(await alignSessionOrganization(MANORS)).toEqual({ status: 'switched' });
    expect((await getSessionById(currentSessionId, 'mock'))?.organizationId).toBe(MANORS);
    expect(await alignSessionOrganization(MANORS)).toEqual({ status: 'aligned' });
    expect(await alignSessionOrganization('all')).toEqual({ status: 'denied' });
    expect(await alignSessionOrganization('Not An Id!')).toEqual({ status: 'denied' });

    await signInAs(GUS_ADMIN_IDENTITY_ID);
    expect(await alignSessionOrganization(MANORS)).toEqual({ status: 'denied' });
    expect((await getSessionById(currentSessionId, 'mock'))?.organizationId ?? null).not.toBe(MANORS);
  });

  it('a Manors case requested under Gus is not found; under Manors by a Gus-only person, refused', async () => {
    const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
    await signInAs(CASEY_DUAL_IDENTITY_ID);
    const wrongOrg = await caseRoute.GET(new Request(`http://localhost/api/cases/${manorsCase.id}?organizationId=${GUS}`), { params: Promise.resolve({ caseId: manorsCase.id }) });
    expect(wrongOrg.status).toBe(404);
    const rightOrg = await caseRoute.GET(new Request(`http://localhost/api/cases/${manorsCase.id}?organizationId=${MANORS}`), { params: Promise.resolve({ caseId: manorsCase.id }) });
    expect(rightOrg.status).toBe(200);

    await signInAs(GUS_ADMIN_IDENTITY_ID);
    const outsider = await caseRoute.GET(new Request(`http://localhost/api/cases/${manorsCase.id}?organizationId=${MANORS}`), { params: Promise.resolve({ caseId: manorsCase.id }) });
    expect(outsider.status).toBe(403);
  });
});

describe('new cases: one specific organization, never a combined context; historical organizations open none', () => {
  it('a case create naming "all" or the other tenant is refused', async () => {
    await signInAs(GUS_ADMIN_IDENTITY_ID);
    expect((await casesRoute.POST(json({ organizationId: 'all', decedentName: 'X' }))).status).toBe(403);
    expect((await casesRoute.POST(json({ organizationId: MANORS, decedentName: 'X' }))).status).toBe(403);
  });

  it('historical (fictional scenario): Manors refuses new cases; its existing cases stay readable; Gus unaffected', async () => {
    expect(organizationAcceptsNewCases(MANORS)).toBe(true); // both Active in the real configuration
    state.historical = MANORS;
    expect(organizationAcceptsNewCases(MANORS)).toBe(false);
    await signInAs(ROBIN_DUAL_IDENTITY_ID);
    const refused = await casesRoute.POST(json({ organizationId: MANORS, decedentName: 'EXAMPLE NEW' }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/historical/);
    const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
    const readable = await caseRoute.GET(new Request(`http://localhost/api/cases/${manorsCase.id}?organizationId=${MANORS}`), { params: Promise.resolve({ caseId: manorsCase.id }) });
    expect(readable.status).toBe(200);
    expect(organizationAcceptsNewCases(GUS)).toBe(true);
  });
});

describe('portal-scoped MFA on the unified portal (fictional)', () => {
  const post = (body: unknown) => new Request('http://localhost/api/auth/mfa/setup-grants', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('someone with two-step verification elsewhere cannot work here on a password-only session; an administrator issues a one-time setup code (never for themselves, never a non-administrator)', async () => {
    vi.stubEnv('SOLIS_PORTAL_SCOPED_MFA', 'true');
    try {
      // Casey enrolled at "Manors Production" (the original field on the shared record).
      await updateIdentity(CASEY_DUAL_IDENTITY_ID, { mfaEnabled: true }, 'mock');
      await signInAs(CASEY_DUAL_IDENTITY_ID);
      const gate = await requireAuthorizedOrganization(GUS);
      expect(gate.authorized).toBe(false);
      if (!gate.authorized) expect((await gate.response.json()).error ?? '').toMatch(/two-factor|MFA|enroll/i);
      // Casey (Gus Manager) cannot issue codes, for anyone.
      expect((await issueSetupCode(post({ organizationId: GUS, identityId: ROBIN_DUAL_IDENTITY_ID }))).status).not.toBe(201);

      await signInAs(GUS_ADMIN_IDENTITY_ID);
      expect((await issueSetupCode(post({ organizationId: GUS, identityId: GUS_ADMIN_IDENTITY_ID }))).status).toBe(403); // self
      const issued = await issueSetupCode(post({ organizationId: GUS, identityId: CASEY_DUAL_IDENTITY_ID }));
      expect(issued.status).toBe(201);
      expect(issued.headers.get('cache-control')).toBe('no-store');
      const { code } = await issued.json();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(JSON.stringify(portalMfaSetupGrantFixtures)).not.toContain(code);
      // Not for a member of another organization.
      expect((await issueSetupCode(post({ organizationId: MANORS, identityId: CASEY_DUAL_IDENTITY_ID }))).status).toBe(403);
    } finally {
      await updateIdentity(CASEY_DUAL_IDENTITY_ID, { mfaEnabled: false }, 'mock');
      portalMfaSetupGrantFixtures.length = 0;
      vi.unstubAllEnvs();
    }
  });
});
