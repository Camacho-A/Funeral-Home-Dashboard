import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { resourceFixtures, appointmentResourceAssignmentFixtures } from '@/services/__mocks__/schedulingFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET } = await import('./route');
const { create: createResource } = await import('@/services/resourceService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-availability-${idCounter}`;
}

function getRequest(resourceId: string, query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/scheduling/resources/${resourceId}/availability?${params.toString()}`), { params: Promise.resolve({ resourceId }) });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  resourceFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
});
afterEach(() => {
  resourceFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
});

describe('GET /api/scheduling/resources/[resourceId]/availability', () => {
  it('returns 400 with no from/to', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    const response = await getRequest(resource.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(400);
  });

  it('returns the booked windows for a range', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    const response = await getRequest(resource.id, { organizationId: DEFAULT_ORGANIZATION_ID, from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assignments).toEqual([]);
    expect(body.unavailability).toEqual([]);
  });
});
