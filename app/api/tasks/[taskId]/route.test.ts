import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();
let mockUpdateWixDataItem = vi.fn();
let mockDeleteWixDataItem = vi.fn();
let mockInsertWixDataItem = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    updateWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockUpdateWixDataItem(...args);
    },
    deleteWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockDeleteWixDataItem(...args);
    },
    // Phase 24 (Case Activity Timeline & Audit Center): activityService's
    // record() calls this for a case.task.completed activity event.
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
  };
});

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { PATCH, DELETE } = await import('./route');

const EXISTING_WIX_TASK_DATA = {
  beaconTaskId: 'task-100',
  organizationId: DEFAULT_ORGANIZATION_ID,
  text: 'Existing task',
  assigneeId: 'staff-dana',
  isDone: false,
  caseId: null,
  createdAt: '2026-07-22T00:00:00.000Z',
};

function patchRequest(taskId: string, body: unknown, headers: Record<string, string> = {}) {
  return PATCH(
    new Request(`http://localhost/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ taskId }) },
  );
}

function deleteRequest(taskId: string, organizationId: string | null, headers: Record<string, string> = {}) {
  const url = organizationId
    ? `http://localhost/api/tasks/${taskId}?organizationId=${organizationId}`
    : `http://localhost/api/tasks/${taskId}`;
  return DELETE(
    new Request(url, { method: 'DELETE', headers: { origin: 'http://localhost', host: 'localhost', ...headers } }),
    { params: Promise.resolve({ taskId }) },
  );
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.DATA_ADAPTER = 'wix';
  process.env.WIX_API_KEY = 'test-key';
  process.env.WIX_SITE_ID = 'test-site';
  mockQueryWixDataItems = vi.fn().mockResolvedValue({
    dataItems: [{ id: 'task-100', dataCollectionId: 'tasks', data: EXISTING_WIX_TASK_DATA }],
  });
  mockUpdateWixDataItem = vi.fn().mockImplementation((_c: string, itemId: string, data: Record<string, unknown>) =>
    Promise.resolve({ id: itemId, dataCollectionId: 'tasks', data }),
  );
  mockDeleteWixDataItem = vi.fn().mockResolvedValue(undefined);
  mockInsertWixDataItem = vi.fn().mockResolvedValue({ id: 'activity-event-mock', dataCollectionId: 'activityEvents', data: {} });
  mockSession = { user: mockDefaultUser };
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('PATCH /api/tasks/[taskId] — authorization', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest(
      'task-100',
      { organizationId: DEFAULT_ORGANIZATION_ID, patch: { text: 'x' } },
      { origin: 'https://evil.example.com' },
    );
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session at all', async () => {
    mockSession = null;
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { text: 'x' } });
    expect(response.status).toBe(401);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('returns 403 for a forged organizationId — rejected before any lookup or write', async () => {
    const response = await patchRequest('task-100', { organizationId: SECOND_MOCK_ORGANIZATION_ID, patch: { text: 'x' } });
    expect(response.status).toBe(403);
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it("returns 404 when the task belongs to a different organization the caller IS authorized for — cross-tenant update rejected", async () => {
    mockSession = { user: mockMultiOrgUser };
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });
    const response = await patchRequest('task-100', { organizationId: SECOND_MOCK_ORGANIZATION_ID, patch: { text: 'x' } });
    expect(response.status).toBe(404);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('returns 404 for a fabricated task id', async () => {
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });
    const response = await patchRequest('no-such-task', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { text: 'x' } });
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/tasks/[taskId] — validation', () => {
  it('returns 400 when organizationId is missing from the body', async () => {
    const response = await patchRequest('task-100', { patch: { text: 'x' } });
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/tasks/task-100', {
        method: 'PATCH',
        headers: { origin: 'http://localhost', host: 'localhost' },
        body: '{not json',
      }),
      { params: Promise.resolve({ taskId: 'task-100' }) },
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when a patch field is present but the wrong type', async () => {
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDone: 'yes' } });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/isDone/);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('returns 400 when DATA_ADAPTER is not wix', async () => {
    process.env.DATA_ADAPTER = 'mock';
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { text: 'x' } });
    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/tasks/[taskId] — protected-field reassignment', () => {
  it('ignores an attempt to reassign organizationId/caseId via the patch', async () => {
    await patchRequest('task-100', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { text: 'Renamed', organizationId: SECOND_MOCK_ORGANIZATION_ID, caseId: 'forged-case' },
    });

    const mergedData = mockUpdateWixDataItem.mock.calls[0][2];
    expect(mergedData.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(mergedData.caseId).toBe(EXISTING_WIX_TASK_DATA.caseId);
    expect(mergedData.text).toBe('Renamed');
  });
});

describe('PATCH /api/tasks/[taskId] — successful mutations', () => {
  it('renames a task (text update) and returns the mapped result', async () => {
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { text: 'Renamed Task' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task.text).toBe('Renamed Task');
  });

  it('completes a task (isDone: true)', async () => {
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDone: true } });
    const body = await response.json();
    expect(body.task.isDone).toBe(true);
  });

  it('Phase 24: completing a case-linked task records a case.task.completed activity event', async () => {
    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [{ id: 'task-100', dataCollectionId: 'tasks', data: { ...EXISTING_WIX_TASK_DATA, caseId: 'case-1' } }],
    });

    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDone: true } });
    expect(response.status).toBe(200);

    expect(mockInsertWixDataItem).toHaveBeenCalledWith(
      'activityEvents',
      expect.objectContaining({ eventType: 'case.task.completed', category: 'cases', caseId: 'case-1', resourceId: 'task-100' }),
      expect.any(String),
    );
  });

  it('Phase 24: a general (non-case-linked) task completion records no activity event', async () => {
    // EXISTING_WIX_TASK_DATA's default caseId is null.
    await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDone: true } });
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('Phase 24: reopening a task (isDone: false) does not record a completion event', async () => {
    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [{ id: 'task-100', dataCollectionId: 'tasks', data: { ...EXISTING_WIX_TASK_DATA, caseId: 'case-1', isDone: true } }],
    });
    await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDone: false } });
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('reopens a task (isDone: false)', async () => {
    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [{ id: 'task-100', dataCollectionId: 'tasks', data: { ...EXISTING_WIX_TASK_DATA, isDone: true } }],
    });
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDone: false } });
    const body = await response.json();
    expect(body.task.isDone).toBe(false);
  });

  it('sends the full merged object to Wix, preserving fields the patch did not touch', async () => {
    await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDone: true } });
    const mergedData = mockUpdateWixDataItem.mock.calls[0][2];
    expect(mergedData.text).toBe(EXISTING_WIX_TASK_DATA.text);
    expect(mergedData.assigneeId).toBe(EXISTING_WIX_TASK_DATA.assigneeId);
  });
});

describe('PATCH /api/tasks/[taskId] — Wix failure handling', () => {
  it('propagates a Wix write failure as a 503 without leaking internal details', async () => {
    mockUpdateWixDataItem.mockRejectedValue(new Error('Wix Data update failed for collection "tasks" (HTTP 500).'));
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { text: 'x' } });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).not.toMatch(/test-key/);
  });
});

describe('DELETE /api/tasks/[taskId] — authorization', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await deleteRequest('task-100', DEFAULT_ORGANIZATION_ID, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 401 when there is no session at all', async () => {
    mockSession = null;
    const response = await deleteRequest('task-100', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(401);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('returns 403 for a forged organizationId — rejected before any lookup or delete', async () => {
    const response = await deleteRequest('task-100', SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(403);
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it("returns 404 when the task belongs to a different organization the caller IS authorized for — cross-tenant delete rejected", async () => {
    mockSession = { user: mockMultiOrgUser };
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });
    const response = await deleteRequest('task-100', SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(404);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('returns 400 when organizationId is missing from the query string', async () => {
    const response = await deleteRequest('task-100', null);
    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/tasks/[taskId] — success and failure', () => {
  it('deletes an authorized task and returns 204', async () => {
    const response = await deleteRequest('task-100', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(204);
    expect(mockDeleteWixDataItem).toHaveBeenCalledWith('tasks', 'task-100');
  });

  it('returns 404 for a fabricated task id', async () => {
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });
    const response = await deleteRequest('no-such-task', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('propagates a Wix delete failure as a 503 without leaking internal details', async () => {
    mockDeleteWixDataItem.mockRejectedValue(new Error('Wix Data delete failed for collection "tasks" (HTTP 500).'));
    const response = await deleteRequest('task-100', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).not.toMatch(/test-key/);
  });
});

describe('PATCH /api/tasks/[taskId] — Phase 30 (Identity Model Hardening & Staff Assignment Unification): assigneeStaffId reassignment', () => {
  const CHRIS_PROFILE_ITEM = {
    id: 'staff-chris',
    dataCollectionId: 'staffProfiles',
    data: {
      beaconStaffProfileId: 'staff-chris',
      organizationId: DEFAULT_ORGANIZATION_ID,
      identityId: 'identity-manors-chris',
      membershipId: null,
      displayName: 'Chris',
      role: 'funeral_director',
      isActive: true,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
    },
  };
  const ADMINISTRATOR_ROLE_ITEM = {
    id: 'role-administrator',
    dataCollectionId: 'roles',
    data: {
      beaconRoleId: 'role-administrator',
      key: 'administrator',
      name: 'Administrator',
      description: 'Full access.',
      organizationId: null,
      isSystemDefault: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
  const ADMINISTRATOR_ROLE_PERMISSION_ITEMS = ['case.update', 'task.assign'].map((permissionKey) => ({
    id: `role-permission-administrator-${permissionKey}`,
    dataCollectionId: 'rolePermissions',
    data: { beaconRolePermissionId: `role-permission-administrator-${permissionKey}`, roleId: 'role-administrator', permissionKey, createdAt: '2026-01-01T00:00:00.000Z' },
  }));

  function mockTaskAndStaffProfiles(staffProfileItem: typeof CHRIS_PROFILE_ITEM | null) {
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'staffProfiles') return Promise.resolve({ dataItems: staffProfileItem ? [staffProfileItem] : [] });
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
      return Promise.resolve({ dataItems: [{ id: 'task-100', dataCollectionId: 'tasks', data: EXISTING_WIX_TASK_DATA }] });
    });
  }

  it('accepts reassignment to an active, in-organization staff profile, and sends a task.assigned notification', async () => {
    mockTaskAndStaffProfiles(CHRIS_PROFILE_ITEM);
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assigneeStaffId: 'staff-chris' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith('tasks', 'task-100', expect.objectContaining({ assigneeId: 'staff-chris' }));
    expect(mockInsertWixDataItem).toHaveBeenCalledWith('notifications', expect.objectContaining({ notificationType: 'task.assigned' }), expect.any(String));
    void body;
  });

  it('rejects reassignment to a nonexistent staff profile, with 422, before any write', async () => {
    mockTaskAndStaffProfiles(null);
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assigneeStaffId: 'staff-does-not-exist' } });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/staff-does-not-exist/);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects reassignment to a deactivated staff profile, with 422', async () => {
    mockTaskAndStaffProfiles({ ...CHRIS_PROFILE_ITEM, data: { ...CHRIS_PROFILE_ITEM.data, isActive: false } });
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assigneeStaffId: 'staff-chris' } });

    expect(response.status).toBe(422);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('does not send a notification when the patch names the same staff member already assigned (a no-op reassignment)', async () => {
    const DANA_PROFILE_ITEM = { ...CHRIS_PROFILE_ITEM, id: 'staff-dana', data: { ...CHRIS_PROFILE_ITEM.data, beaconStaffProfileId: 'staff-dana', displayName: 'Dana' } };
    mockTaskAndStaffProfiles(DANA_PROFILE_ITEM);
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assigneeStaffId: 'staff-dana' } });

    expect(response.status).toBe(200);
    expect(mockInsertWixDataItem).not.toHaveBeenCalledWith('notifications', expect.objectContaining({ notificationType: 'task.assigned' }), expect.any(String));
  });

  it('allows unassigning (a null patch value) with no staff-profile lookup at all', async () => {
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'staffProfiles') throw new Error('must not be queried for a null (unassign) patch');
      return Promise.resolve({ dataItems: [{ id: 'task-100', dataCollectionId: 'tasks', data: EXISTING_WIX_TASK_DATA }] });
    });
    const response = await patchRequest('task-100', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assigneeStaffId: null } });
    expect(response.status).toBe(200);
  });
});
