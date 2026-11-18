import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUS_CAMACHO_ORGANIZATION_ID } from '@/domain/organization/organizationProfiles';

/** Settings › Funeral Director Credentials API (Gus Phase 5G): administrators only. Fictional data. */
let session = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, userId: 'identity-gus-admin', role: 'administrator' };
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) =>
    requested !== session.organizationId
      ? { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) }
      : { authorized: true, context: { organizationId: requested, userId: session.userId, role: session.role } },
  ),
}));

const { GET, POST } = await import('./route');
const { funeralDirectorCredentialFixtures } = await import('@/services/__mocks__/funeralDirectorCredentialFixtures');
const { buildGusCredentialFixtures } = await import('@/services/__mocks__/gusFixtures');

const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const get = (org = GUS_CAMACHO_ORGANIZATION_ID) => GET(new Request(`http://localhost/api/settings/funeral-director-credentials?organizationId=${org}`));
const post = (body: Record<string, unknown>, headers = SAME_ORIGIN) =>
  POST(new Request('http://localhost/api/settings/funeral-director-credentials', { method: 'POST', headers, body: JSON.stringify({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, ...body }) }));
const grantDirector = { staffProfileId: 'staff-gus-director', expectedRevision: 2, change: { kind: 'grant_authorization' } };

beforeEach(() => {
  funeralDirectorCredentialFixtures.length = 0;
  funeralDirectorCredentialFixtures.push(...buildGusCredentialFixtures());
});
afterEach(() => {
  session = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, userId: 'identity-gus-admin', role: 'administrator' };
});

describe('/api/settings/funeral-director-credentials', () => {
  it('an administrator can list and change another person’s credentials', async () => {
    expect((await get()).status).toBe(200);
    const response = await post(grantDirector);
    expect(response.status).toBe(200);
    expect((await response.json()).record.authorization.authorizedBy).toBe('identity-gus-admin');
  });

  it('a Funeral Director (not an administrator) and a read-only user are refused', async () => {
    for (const role of ['funeralDirector', 'readOnly']) {
      session = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, userId: `identity-${role}`, role };
      expect((await get()).status).toBe(403);
      expect((await post(grantDirector)).status).toBe(403);
    }
    expect(funeralDirectorCredentialFixtures.find((r) => r.staffProfileId === 'staff-gus-director')!.authorization).toBeNull();
  });

  it('an administrator cannot authorize themselves', async () => {
    const response = await post({ staffProfileId: 'staff-gus-admin', expectedRevision: 0, change: { kind: 'grant_authorization' } });
    expect(response.status).toBe(403);
  });

  it('refuses another organization, a cross-site request and malformed input', async () => {
    expect((await get('managed-cremations')).status).toBe(403);
    expect((await post(grantDirector, { ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ staffProfileId: 'staff-gus-director', expectedRevision: 2, change: { kind: 'make_me_director' } })).status).toBe(400);
  });
});
