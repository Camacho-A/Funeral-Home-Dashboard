import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { taskFixtures } from '@/services/__mocks__/fixtures';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
  };
});

const { GET } = await import('./route');

function requestFor(organizationId: string | null, caseId?: string) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  if (caseId) params.set('caseId', caseId);
  return new Request(`http://localhost/api/tasks?${params.toString()}`);
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
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

  it('a mismatched organizationId returns an empty list, not a cross-tenant leak', async () => {
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

  it('returns an empty array for an organization with no tasks', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await GET(requestFor('org-with-no-tasks'));
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

  it('a task belonging to another organization cannot be returned via a case-filtered query (compound filter behavior delegated to Wix)', async () => {
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
