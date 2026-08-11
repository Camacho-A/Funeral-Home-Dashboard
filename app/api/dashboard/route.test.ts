import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/dashboard?organizationId=${organizationId}`));
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
});

describe('GET /api/dashboard', () => {
  it('returns 400 without organizationId', async () => {
    expect((await GET(new Request('http://localhost/api/dashboard'))).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns every section for an administrator', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.today).toBeDefined();
    expect(body.operations).not.toBeNull();
    expect(body.financial).not.toBeNull();
    expect(body.attention).not.toBeNull();
  });

  it('nulls out operations/financial/attention for a caller with neither permission (officeStaff)', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.today).toBeDefined();
    expect(body.operations).toBeNull();
    expect(body.financial).toBeNull();
    expect(body.attention).toBeNull();
  });
});
