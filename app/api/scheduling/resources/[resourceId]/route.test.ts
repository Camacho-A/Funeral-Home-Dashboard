import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { resourceFixtures } from '@/services/__mocks__/schedulingFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');
const { create: createResource } = await import('@/services/resourceService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-resource-${idCounter}`;
}

function patchRequest(resourceId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/scheduling/resources/${resourceId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ resourceId }) });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  resourceFixtures.length = 0;
});
afterEach(() => {
  resourceFixtures.length = 0;
});

describe('PATCH /api/scheduling/resources/[resourceId]', () => {
  it('rejects an invalid status', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    const response = await patchRequest(resource.id, { organizationId: DEFAULT_ORGANIZATION_ID, status: 'bogus' });
    expect(response.status).toBe(400);
  });

  it('changes lifecycle status', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    const response = await patchRequest(resource.id, { organizationId: DEFAULT_ORGANIZATION_ID, status: 'maintenance' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resource.status).toBe('maintenance');
  });

  it('updates descriptive fields', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    const response = await patchRequest(resource.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'East Chapel' });
    const body = await response.json();
    expect(body.resource.name).toBe('East Chapel');
  });

  it('returns 404 for an unknown resource', async () => {
    const response = await patchRequest('no-such-resource', { organizationId: DEFAULT_ORGANIZATION_ID, name: 'x' });
    expect(response.status).toBe(404);
  });
});
