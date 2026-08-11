import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(metricKey: string, organizationId: string) {
  return GET(new Request(`http://localhost/api/metrics/${metricKey}?organizationId=${organizationId}`), { params: Promise.resolve({ metricKey }) });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
});

describe('GET /api/metrics/[metricKey]', () => {
  it('returns 400 without organizationId', async () => {
    expect((await GET(new Request('http://localhost/api/metrics/cases.active'), { params: Promise.resolve({ metricKey: 'cases.active' }) })).status).toBe(400);
  });

  it('returns 404 for an unknown metric key', async () => {
    expect((await getRequest('not.a.metric', DEFAULT_ORGANIZATION_ID)).status).toBe(404);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest('cases.active', SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns 403 for a role without the metric\'s own permission (officeStaff)', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest('cases.active', DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns the metric value for an administrator', async () => {
    const response = await getRequest('cases.active', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.metricKey).toBe('cases.active');
    expect(typeof body.value).toBe('number');
  });
});
