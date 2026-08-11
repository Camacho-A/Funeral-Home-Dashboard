import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/reports?organizationId=${organizationId}`));
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
});

describe('GET /api/reports', () => {
  it('returns 400 without organizationId', async () => {
    expect((await GET(new Request('http://localhost/api/reports'))).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns every report for an administrator, including financial ones', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reports.length).toBeGreaterThan(0);
    expect(body.reports.some((r: { key: string }) => r.key === 'trial-balance')).toBe(true);
    expect(body.reports.some((r: { key: string }) => r.key === 'active-cases')).toBe(true);
  });

  it('denies a caller with no report.view at all (officeStaff)', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });
});
