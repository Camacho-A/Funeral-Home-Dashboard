import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUS_CAMACHO_ORGANIZATION_ID } from '@/domain/organization/organizationProfiles';

/** Service preparation route (Gus Phase 5C): case.read to view, case.update to change. Fictional data, mock mode. */
let session = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, userId: 'identity-gus-director', role: 'manager' };
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) =>
    requested !== session.organizationId
      ? { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) }
      : { authorized: true, context: { organizationId: requested, userId: session.userId, role: session.role } },
  ),
}));
const permissions = vi.hoisted(() => ({ read: true, edit: true }));
vi.mock('@/services/authorizationPolicyService', async () => ({
  ...(await vi.importActual<object>('@/services/authorizationPolicyService')),
  canReadCases: vi.fn(async () => permissions.read),
  canEditCase: vi.fn(async () => permissions.edit),
}));

const { GET, POST } = await import('./route');
const { caseFixtures } = await import('@/services/__mocks__/fixtures');

const CASE_ID = 'gus-case-010';
const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const params = { params: Promise.resolve({ caseId: CASE_ID }) };
const index = caseFixtures.findIndex((c) => c.id === CASE_ID && c.organizationId === GUS_CAMACHO_ORGANIZATION_ID);
const original = caseFixtures[index];
const choice = { kind: 'choice', choice: 'prayerCards', value: 'requested' };
const post = (body: Record<string, unknown>, headers: Record<string, string> = SAME_ORIGIN) =>
  POST(new Request(`http://localhost/api/cases/${CASE_ID}/service-preparation`, { method: 'POST', headers, body: JSON.stringify({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, ...body }) }), params);
const get = (organizationId = GUS_CAMACHO_ORGANIZATION_ID) => GET(new Request(`http://localhost/api/cases/${CASE_ID}/service-preparation?organizationId=${organizationId}`), params);

beforeEach(() => {
  permissions.read = true;
  permissions.edit = true;
});
afterEach(() => {
  caseFixtures[index] = original;
  session = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, userId: 'identity-gus-director', role: 'manager' };
});

describe('/api/cases/[caseId]/service-preparation', () => {
  it('saves a change and returns it on the next read', async () => {
    const saved = await post({ change: choice, basis: { at: null } });
    expect(saved.status).toBe(200);
    const read = await get();
    expect(read.status).toBe(200);
    const body = await read.json();
    expect(body.canEdit).toBe(true);
    // The release check for the person asking (Phase 5F) — never active.
    expect(body.release.canRelease).toBe(false);
    expect(body.release.prerequisites.map((p: { key: string }) => p.key)).toEqual(expect.arrayContaining(['service_completed', 'state_permit', 'approver_licensed']));
    expect(body.preparation.record.choices.prayerCards.value).toBe('requested');
  });

  it('staff without case.update can view but not change', async () => {
    permissions.edit = false;
    expect((await post({ change: choice, basis: { at: null } })).status).toBe(403);
    expect(caseFixtures[index].servicePreparation).toBeUndefined();
    const read = await get();
    expect((await read.json()).canEdit).toBe(false);
  });

  it('staff without case.read cannot view', async () => {
    permissions.read = false;
    expect((await get()).status).toBe(403);
  });

  it('refuses another organization, a cross-site request, and malformed input', async () => {
    expect((await get('managed-cremations')).status).toBe(403);
    expect((await post({ change: choice, basis: { at: null } }, { ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ change: { kind: 'item', itemId: 'prep.casket.ordered', status: 'done' }, basis: { at: null } })).status).toBe(400);
    expect((await post({ change: choice })).status).toBe(400);
    expect(caseFixtures[index].servicePreparation).toBeUndefined();
  });

  it('a stale change comes back as 409 with the latest preparation', async () => {
    await post({ change: choice, basis: { at: null } });
    const stale = await post({ change: { ...choice, value: 'not_requested' }, basis: { at: null } });
    expect(stale.status).toBe(409);
    expect((await stale.json()).preparation.record.choices.prayerCards.value).toBe('requested');
  });
});
