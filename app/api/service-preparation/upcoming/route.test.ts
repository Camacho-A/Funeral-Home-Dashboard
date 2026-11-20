import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/service-preparation/upcoming (Gus Phase 5L). */
const auth = vi.hoisted(() => ({ canRead: true }));
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (organizationId: string) => ({ authorized: true, context: { organizationId, userId: 'identity-gus-admin', role: 'administrator' } })),
}));
vi.mock('@/lib/env', () => ({ getDataAdapterMode: () => 'mock' }));
vi.mock('@/services/authorizationPolicyService', () => ({ canReadCases: vi.fn(async () => auth.canRead) }));

const { GET } = await import('./route');
const get = (query: string) => GET(new Request(`http://localhost/api/service-preparation/upcoming${query}`));

beforeEach(() => (auth.canRead = true));

describe('GET upcoming services', () => {
  it('needs the organization and case.read', async () => {
    expect((await get('')).status).toBe(400);
    auth.canRead = false;
    expect((await get('?organizationId=gus-camacho-jr')).status).toBe(403);
  });

  it('Gus gets a list; Manors gets 404', async () => {
    const gus = await get('?organizationId=gus-camacho-jr');
    expect(gus.status).toBe(200);
    expect(Array.isArray((await gus.json()).services)).toBe(true);
    expect((await get('?organizationId=managed-cremations')).status).toBe(404);
  });
});
