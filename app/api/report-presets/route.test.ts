import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { reportPresetFixtures } from '@/services/__mocks__/reportingFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, POST } = await import('./route');

function getRequest(organizationId: string, reportKey?: string) {
  const qs = reportKey ? `organizationId=${organizationId}&reportKey=${reportKey}` : `organizationId=${organizationId}`;
  return GET(new Request(`http://localhost/api/report-presets?${qs}`));
}
function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/report-presets', { method: 'POST', headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  reportPresetFixtures.length = 0;
});

describe('GET /api/report-presets', () => {
  it('returns 400 without organizationId', async () => {
    expect((await GET(new Request('http://localhost/api/report-presets'))).status).toBe(400);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns an empty list when none exist', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect((await response.json()).presets).toEqual([]);
  });
});

describe('POST /api/report-presets', () => {
  it('returns 403 without the Origin header (CSRF)', async () => {
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, reportKey: 'active-cases', name: 'Mine', filters: '{}' },
      {},
    );
    expect(response.status).toBe(403);
  });

  it('returns 400 for a missing name', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, reportKey: 'active-cases', filters: '{}' });
    expect(response.status).toBe(400);
  });

  it('creates a private preset for an administrator', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, reportKey: 'active-cases', name: 'My view', filters: '{}' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preset.isShared).toBe(false);
    expect(reportPresetFixtures).toHaveLength(1);
  });

  it('refuses a shared preset from a caller without dashboard.manage (officeStaff)', async () => {
    mockSession = { user: mockMultiOrgUser };
    // officeStaff (mockMultiOrgUser in DEFAULT_ORGANIZATION_ID) lacks report.view
    // entirely, so this exercises the base gate; the dashboard.manage-specific
    // rejection is covered directly in reportPresetService.test.ts.
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, reportKey: 'active-cases', name: 'Org view', filters: '{}', isShared: true });
    expect(response.status).toBe(403);
  });
});
