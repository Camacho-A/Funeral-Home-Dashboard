import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function requestFor(organizationId: string | null) {
  const url = organizationId
    ? `http://localhost/api/service-catalog?organizationId=${organizationId}`
    : 'http://localhost/api/service-catalog';
  return GET(new Request(url));
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
});

describe('GET /api/service-catalog', () => {
  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await requestFor(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await requestFor(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns 400 when organizationId is missing', async () => {
    expect((await requestFor(null)).status).toBe(400);
  });

  it("returns Manor's Cremation's five seeded services", async () => {
    const response = await requestFor(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { catalog: Array<{ serviceCode: string }> };
    expect(body.catalog.map((s) => s.serviceCode)).toEqual([
      'DIRECT_CREMATION',
      'WEIGHT_SURCHARGE_201_250',
      'WEIGHT_SURCHARGE_251_300',
      'EXTRA_DEATH_CERTIFICATE',
      'MAIL_CREMATED_REMAINS',
    ]);
  });
});
