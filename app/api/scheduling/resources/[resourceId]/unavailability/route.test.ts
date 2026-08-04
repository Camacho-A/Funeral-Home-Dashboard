import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { resourceFixtures, resourceUnavailabilityFixtures } from '@/services/__mocks__/schedulingFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { POST } = await import('./route');
const { create: createResource } = await import('@/services/resourceService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-unavailability-${idCounter}`;
}

function postRequest(resourceId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/scheduling/resources/${resourceId}/unavailability`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ resourceId }) });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  resourceFixtures.length = 0;
  resourceUnavailabilityFixtures.length = 0;
});
afterEach(() => {
  resourceFixtures.length = 0;
  resourceUnavailabilityFixtures.length = 0;
});

describe('POST /api/scheduling/resources/[resourceId]/unavailability', () => {
  it('rejects an invalid reason', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    const response = await postRequest(resource.id, { organizationId: DEFAULT_ORGANIZATION_ID, startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-09-05T00:00:00.000Z', reason: 'bogus' });
    expect(response.status).toBe(400);
  });

  it('records a maintenance window', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    const response = await postRequest(resource.id, { organizationId: DEFAULT_ORGANIZATION_ID, startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-09-05T00:00:00.000Z', reason: 'maintenance' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.unavailability.reason).toBe('maintenance');
  });

  it('requires resource.manage-tier authority', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(resource.id, { organizationId: DEFAULT_ORGANIZATION_ID, startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-09-05T00:00:00.000Z', reason: 'maintenance' });
    expect(response.status).toBe(403);
  });
});
