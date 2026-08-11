import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(reportKey: string, organizationId: string, extraParams = '') {
  return GET(new Request(`http://localhost/api/reports/${reportKey}?organizationId=${organizationId}${extraParams}`), { params: Promise.resolve({ reportKey }) });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
});

describe('GET /api/reports/[reportKey]', () => {
  it('returns 400 without organizationId', async () => {
    expect((await GET(new Request('http://localhost/api/reports/active-cases'), { params: Promise.resolve({ reportKey: 'active-cases' }) })).status).toBe(400);
  });

  it('returns 404 for an unknown report key', async () => {
    expect((await getRequest('not-a-report', DEFAULT_ORGANIZATION_ID)).status).toBe(404);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest('active-cases', DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest('active-cases', SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns 403 for a role without the report\'s own permission (officeStaff on a financial report)', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest('trial-balance', DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('runs a metrics-kind report for an administrator', async () => {
    const response = await getRequest('active-cases', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe('metrics');
    expect(body.metrics.some((m: { metricKey: string }) => m.metricKey === 'cases.active')).toBe(true);
  });

  it('runs a financial-kind report for an administrator', async () => {
    const response = await getRequest('trial-balance', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe('financial');
    expect(body.financialReportKey).toBe('trialBalance');
  });

  it('returns 400 when the general-ledger report is requested without an accountId', async () => {
    const response = await getRequest('general-ledger', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(400);
  });
});
