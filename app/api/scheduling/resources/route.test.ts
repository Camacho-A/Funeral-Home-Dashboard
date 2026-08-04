import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { resourceFixtures } from '@/services/__mocks__/schedulingFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET, POST } = await import('./route');

function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/scheduling/resources?${params.toString()}`));
}

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/scheduling/resources', { method: 'POST', headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  resourceFixtures.length = 0;
});
afterEach(() => {
  resourceFixtures.length = 0;
});

describe('GET /api/scheduling/resources', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest({})).status).toBe(400);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID })).status).toBe(403);
  });

  it('lists resources, filterable by resourceType', async () => {
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, resourceType: 'chapel', name: 'Main Chapel' });
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, resourceType: 'vehicle', name: 'Hearse' });
    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID, resourceType: 'chapel' });
    const body = await response.json();
    expect(body.resources).toHaveLength(1);
    expect(body.resources[0].resourceType).toBe('chapel');
  });
});

describe('POST /api/scheduling/resources', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, resourceType: 'chapel', name: 'Main Chapel' }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid resourceType', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, resourceType: 'bogus', name: 'x' });
    expect(response.status).toBe(400);
  });

  it('creates a resource, starting active', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, resourceType: 'chapel', name: 'Main Chapel' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.resource.status).toBe('active');
  });

  it('requires resource.manage-tier authority — a role with only schedule.create is denied', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, resourceType: 'chapel', name: 'Main Chapel' });
    expect(response.status).toBe(403);
  });
});
