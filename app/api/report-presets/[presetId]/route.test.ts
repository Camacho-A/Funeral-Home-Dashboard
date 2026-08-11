import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { reportPresetFixtures } from '@/services/__mocks__/reportingFixtures';
import { create } from '@/services/reportPresetService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { DELETE } = await import('./route');

function deleteRequest(presetId: string, organizationId: string, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return DELETE(new Request(`http://localhost/api/report-presets/${presetId}?organizationId=${organizationId}`, { method: 'DELETE', headers }), { params: Promise.resolve({ presetId }) });
}

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `preset-route-test-${idCounter}`;
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  idCounter = 0;
  reportPresetFixtures.length = 0;
});

describe('DELETE /api/report-presets/[presetId]', () => {
  it('returns 403 without the Origin header (CSRF)', async () => {
    const response = await deleteRequest('bogus-id', DEFAULT_ORGANIZATION_ID, {});
    expect(response.status).toBe(403);
  });

  it('returns 400 without organizationId', async () => {
    const response = await DELETE(new Request('http://localhost/api/report-presets/bogus-id', { method: 'DELETE', headers: { origin: 'http://localhost', host: 'localhost' } }), {
      params: Promise.resolve({ presetId: 'bogus-id' }),
    });
    expect(response.status).toBe(400);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await deleteRequest('bogus-id', SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('removes the caller\'s own preset', async () => {
    const preset = await create(
      DEFAULT_ORGANIZATION_ID,
      { reportKey: 'active-cases', name: 'Mine', filters: '{}', ownerIdentityId: mockDefaultUser.id, canManageDashboard: false, idFactory },
      'mock',
    );
    const response = await deleteRequest(preset.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect(reportPresetFixtures).toHaveLength(0);
  });

  it('returns 404 for an unknown preset id', async () => {
    const response = await deleteRequest('not-a-real-preset', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });
});
