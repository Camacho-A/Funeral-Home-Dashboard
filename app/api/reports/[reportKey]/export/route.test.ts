import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(reportKey: string, organizationId: string) {
  return GET(new Request(`http://localhost/api/reports/${reportKey}/export?organizationId=${organizationId}`), { params: Promise.resolve({ reportKey }) });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
});

describe('GET /api/reports/[reportKey]/export', () => {
  it('returns 400 without organizationId', async () => {
    expect((await GET(new Request('http://localhost/api/reports/active-cases/export'), { params: Promise.resolve({ reportKey: 'active-cases' }) })).status).toBe(400);
  });

  it('returns 404 for an unknown report key', async () => {
    expect((await getRequest('not-a-report', DEFAULT_ORGANIZATION_ID)).status).toBe(404);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest('active-cases', SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns 403 for a role that can view but not export (mockMultiOrgUser is "caseManager" -> funeralDirector in SECOND_MOCK_ORGANIZATION_ID, which has report.operational but not report.export)', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await getRequest('active-cases', SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it('exports a CSV for an administrator, with the correct Content-Type and header row', async () => {
    const response = await getRequest('active-cases', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    const csv = await response.text();
    expect(csv.split('\n')[0]).toBe('metricKey,displayName,value');
  });
});
