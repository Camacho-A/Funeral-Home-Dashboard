import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { taskFixtures } from '@/services/__mocks__/fixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();
let mockInsertWixDataItem = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
  };
});

// Phase 15X (Multi-Tenant Authorization Hardening): see the identical
// comment in app/api/organizations/[organizationId]/route.test.ts. Tests
// that legitimately need to reach the second organization use
// mockMultiOrgUser, which has active memberships in both.
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, POST } = await import('./route');

function requestFor(organizationId: string | null, caseId?: string) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  if (caseId) params.set('caseId', caseId);
  return new Request(`http://localhost/api/tasks?${params.toString()}`);
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_CREATE_BODY = { organizationId: DEFAULT_ORGANIZATION_ID, text: 'New task', assigneeStaffId: 'staff-dana' };

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
  mockInsertWixDataItem = vi.fn();
  mockSession = { user: mockDefaultUser };
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('GET /api/tasks — request validation', () => {
  it('returns 400 when organizationId is missing', async () => {
    const response = await GET(requestFor(null));
    expect(response.status).toBe(400);
  });
});

describe('GET /api/tasks — authorization', () => {
  it('returns 401 when there is no session at all', async () => {
    mockSession = null;
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    expect(response.status).toBe(401);
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });

  it("returns 403 (not an empty list) for the single-org default user requesting the second organization — a forged organizationId is rejected before any fixture lookup", async () => {
    const response = await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.tasks).toBeUndefined();
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });
});

describe('GET /api/tasks — mock mode', () => {
  it("lists only this organization's tasks", async () => {
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tasks.length).toBeGreaterThan(0);
    expect(body.tasks.every((t: { organizationId: string }) => t.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(
      true,
    );
  });

  it("a user authorized for the second organization gets an empty list for it (it has no task fixtures), never organization A's tasks", async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID));
    const body = await response.json();
    expect(body.tasks).toEqual([]);
  });

  it('applies the caseId filter the same way tasksService.list always did', async () => {
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID, 'no-such-case'));
    const body = await response.json();
    expect(body.tasks).toEqual([]);
  });

  it('returns byte-for-byte the same tasks as the fixture filter, matching pre-Phase-15D behavior', async () => {
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();
    const expected = taskFixtures.filter((t) => t.organizationId === DEFAULT_ORGANIZATION_ID);
    expect(body.tasks).toEqual(expected);
  });
});

describe('GET /api/tasks — wix mode', () => {
  it('fails cleanly with a clear message when required config is missing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.tasks).toEqual([]);
    expect(body.error).toMatch(/WIX_API_KEY, WIX_SITE_ID/);
  });

  it('maps a real Wix query result to the domain shape and applies the organizationId filter', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';

    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [
        {
          id: 'x',
          dataCollectionId: 'tasks',
          data: {
            beaconTaskId: 'task-100',
            organizationId: DEFAULT_ORGANIZATION_ID,
            text: 'Test task',
            assigneeId: 'staff-dana',
            isDone: false,
            caseId: null,
            createdAt: '2026-07-22T00:00:00.000Z',
          },
        },
      ],
    });

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe('task-100');
    expect(body.tasks[0].assigneeStaffId).toBe('staff-dana');
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('tasks', {
      filter: { organizationId: DEFAULT_ORGANIZATION_ID },
    });
  });

  it('includes caseId in the Wix filter when provided', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    await GET(requestFor(DEFAULT_ORGANIZATION_ID, '1046'));

    expect(mockQueryWixDataItems).toHaveBeenCalledWith('tasks', {
      filter: { organizationId: DEFAULT_ORGANIZATION_ID, caseId: '1046' },
    });
  });

  it('returns an empty array for an authorized organization with no tasks in Wix', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tasks).toEqual([]);
  });

  it('skips a malformed task record instead of throwing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [{ id: 'x', dataCollectionId: 'tasks', data: { text: 'Missing required fields' } }],
    });

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tasks).toEqual([]);
  });

  it('never leaks a raw API key value into the response, even on failure', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'super-secret-test-value';

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const bodyText = await response.text();
    expect(bodyText).not.toContain('super-secret-test-value');
  });

  it('a task belonging to another organization cannot be returned via a case-filtered query for an org the caller IS authorized for (compound filter behavior delegated to Wix)', async () => {
    mockSession = { user: mockMultiOrgUser };
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID, '1046'));
    const body = await response.json();

    expect(body.tasks).toEqual([]);
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('tasks', {
      filter: { organizationId: SECOND_MOCK_ORGANIZATION_ID, caseId: '1046' },
    });
  });
});

describe('POST /api/tasks', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  describe('authorization', () => {
    it('returns 401 when there is no session at all', async () => {
      mockSession = null;
      const response = await POST(postRequest(VALID_CREATE_BODY));
      expect(response.status).toBe(401);
      expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    });

    it('returns 403 for a forged organizationId — rejected before any write', async () => {
      const response = await POST(postRequest({ ...VALID_CREATE_BODY, organizationId: SECOND_MOCK_ORGANIZATION_ID }));
      expect(response.status).toBe(403);
      expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('returns 400 when organizationId is missing', async () => {
      const { organizationId, ...rest } = VALID_CREATE_BODY;
      void organizationId;
      const response = await POST(postRequest(rest));
      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid JSON', async () => {
      const response = await POST(new Request('http://localhost/api/tasks', { method: 'POST', body: '{not json' }));
      expect(response.status).toBe(400);
    });

    it('returns 400 when text is missing or empty', async () => {
      const response = await POST(postRequest({ ...VALID_CREATE_BODY, text: '' }));
      expect(response.status).toBe(400);
    });

    it('returns 400 when DATA_ADAPTER is not wix', async () => {
      process.env.DATA_ADAPTER = 'mock';
      const response = await POST(postRequest(VALID_CREATE_BODY));
      expect(response.status).toBe(400);
    });
  });

  describe('caseId tenant consistency', () => {
    it('creates a general (case-less) task when caseId is omitted', async () => {
      mockInsertWixDataItem.mockImplementation((_c: string, data: Record<string, unknown>, itemId: string) =>
        Promise.resolve({ id: itemId, dataCollectionId: 'tasks', data: { ...data, beaconTaskId: itemId } }),
      );
      const response = await POST(postRequest(VALID_CREATE_BODY));
      const body = await response.json();
      expect(response.status).toBe(201);
      expect(body.task.caseId).toBeNull();
      expect(mockQueryWixDataItems).not.toHaveBeenCalled(); // no case lookup needed
    });

    it('verifies a provided caseId belongs to the authorized organization before creating the task', async () => {
      mockQueryWixDataItems.mockResolvedValue({ dataItems: [{ id: '1046', dataCollectionId: 'cases', data: {} }] });
      mockInsertWixDataItem.mockImplementation((_c: string, data: Record<string, unknown>, itemId: string) =>
        Promise.resolve({ id: itemId, dataCollectionId: 'tasks', data: { ...data, beaconTaskId: itemId } }),
      );

      const response = await POST(postRequest({ ...VALID_CREATE_BODY, caseId: '1046' }));

      expect(response.status).toBe(201);
      expect(mockQueryWixDataItems).toHaveBeenCalledWith('cases', {
        filter: { beaconCaseId: '1046', organizationId: DEFAULT_ORGANIZATION_ID, isArchived: false },
        paging: { limit: 1 },
      });
    });

    it('rejects a caseId that does not resolve to a case in the authorized organization — a forged cross-tenant caseId', async () => {
      mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });
      const response = await POST(postRequest({ ...VALID_CREATE_BODY, caseId: 'forged-or-other-org-case' }));

      expect(response.status).toBe(400);
      expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    });
  });

  describe('creation', () => {
    it('creates the task and returns the mapped result', async () => {
      mockInsertWixDataItem.mockImplementation((_c: string, data: Record<string, unknown>, itemId: string) =>
        Promise.resolve({ id: itemId, dataCollectionId: 'tasks', data: { ...data, beaconTaskId: itemId } }),
      );
      const response = await POST(postRequest(VALID_CREATE_BODY));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.task.text).toBe('New task');
      expect(body.task.assigneeStaffId).toBe('staff-dana');
      expect(body.task.isDone).toBe(false);
      expect(body.task.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    });

    it('sets the Wix item id to the generated beaconTaskId at insert time', async () => {
      mockInsertWixDataItem.mockImplementation((_c: string, data: Record<string, unknown>, itemId: string) =>
        Promise.resolve({ id: itemId, dataCollectionId: 'tasks', data: { ...data, beaconTaskId: itemId } }),
      );
      await POST(postRequest(VALID_CREATE_BODY));

      const [collectionId, , itemId] = mockInsertWixDataItem.mock.calls[0];
      expect(collectionId).toBe('tasks');
      expect(typeof itemId).toBe('string');
      expect(itemId.length).toBeGreaterThan(0);
    });
  });

  describe('Wix failure handling', () => {
    it('propagates a Wix write failure as a 503 without leaking internal details', async () => {
      mockInsertWixDataItem.mockRejectedValue(new Error('Wix Data insert failed for collection "tasks" (HTTP 500).'));
      const response = await POST(postRequest(VALID_CREATE_BODY));
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).not.toMatch(/test-key/);
    });
  });
});
