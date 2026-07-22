import { afterEach, describe, expect, it, vi } from 'vitest';
import { tasksService } from './tasksService';
import type { OrganizationContext } from '../types/organization';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { taskFixtures } from './__mocks__/fixtures';

const organization: OrganizationContext = { organizationId: DEFAULT_ORGANIZATION_ID };

describe('tasksService.list — mock mode (dataAdapterMode omitted or "mock")', () => {
  it("returns only this organization's tasks, unchanged from before Phase 15D", async () => {
    const tasks = await tasksService.list(organization);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(true);
  });

  it('a mismatched organizationId returns an empty list, not a cross-tenant leak', async () => {
    const tasks = await tasksService.list({ organizationId: 'no-such-org' });
    expect(tasks).toEqual([]);
  });

  it('explicitly passed "mock" behaves identically to omitting the parameter', async () => {
    const withDefault = await tasksService.list(organization);
    const withExplicit = await tasksService.list(organization, {}, 'mock');
    expect(withExplicit).toEqual(withDefault);
  });

  it('filters by caseId the same way it always did', async () => {
    const tasks = await tasksService.list(organization, { caseId: 'no-such-case' });
    expect(tasks).toEqual([]);
  });

  it('read-after-write: a task created via create() is immediately visible to a subsequent mock list() call', async () => {
    const before = await tasksService.list(organization);
    const created = await tasksService.create(organization, {
      text: 'Read-after-write regression check',
      assigneeStaffId: 'staff-dana',
    });

    const after = await tasksService.list(organization);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((t) => t.id === created.id)).toBe(true);
  });

  it('read-after-write: an update() (e.g. marking done) is immediately visible to a subsequent mock list() call', async () => {
    const created = await tasksService.create(organization, {
      text: 'Read-after-update regression check',
      assigneeStaffId: 'staff-dana',
    });
    await tasksService.update(organization, created.id, { isDone: true });

    const tasks = await tasksService.list(organization);
    const found = tasks.find((t) => t.id === created.id);
    expect(found?.isDone).toBe(true);
  });
});

describe('tasksService.list — wix mode (dataAdapterMode = "wix")', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches /api/tasks with organizationId, never touching taskFixtures directly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tasks: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await tasksService.list(organization, {}, 'wix');

    expect(fetchMock).toHaveBeenCalledWith(`/api/tasks?organizationId=${DEFAULT_ORGANIZATION_ID}`);
  });

  it('includes caseId in the fetch URL when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tasks: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await tasksService.list(organization, { caseId: '1046' }, 'wix');

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('caseId=1046');
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(tasksService.list(organization, {}, 'wix')).rejects.toThrow('Failed to load tasks.');
  });

  it('returns the tasks array parsed from the response body', async () => {
    const wixTasks = [
      {
        id: 'task-wix-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        text: 'Wix-sourced task',
        assigneeStaffId: 'staff-dana',
        isDone: false,
        caseId: null,
        createdAt: '2026-07-22T00:00:00.000Z',
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tasks: wixTasks }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await tasksService.list(organization, {}, 'wix');
    expect(result).toEqual(wixTasks);
  });
});

describe('tasksService.create/update/remove — mock mode (dataAdapterMode omitted or "mock")', () => {
  it('create/update/remove continue to operate on the shared client-side taskFixtures array, unchanged since before Phase 16', async () => {
    const before = taskFixtures.length;
    const created = await tasksService.create(organization, {
      text: 'Untouched write path check',
      assigneeStaffId: 'staff-chris',
    });
    expect(taskFixtures.length).toBe(before + 1);
    expect(taskFixtures.some((t) => t.id === created.id)).toBe(true);

    await tasksService.update(organization, created.id, { isDone: true });
    expect(taskFixtures.find((t) => t.id === created.id)?.isDone).toBe(true);

    await tasksService.remove(organization, created.id);
    expect(taskFixtures.some((t) => t.id === created.id)).toBe(false);
  });
});

describe('tasksService.create/update/remove — wix mode (dataAdapterMode = "wix")', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('create() POSTs /api/tasks with organizationId, never touching taskFixtures', async () => {
    const fakeTask = { id: 'new-task', organizationId: DEFAULT_ORGANIZATION_ID, text: 'New', isDone: false, assigneeStaffId: null, caseId: null, createdAt: '2026-07-23T00:00:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ task: fakeTask }) });
    vi.stubGlobal('fetch', fetchMock);

    const before = taskFixtures.length;
    const result = await tasksService.create(organization, { text: 'New', assigneeStaffId: null }, 'wix');

    expect(result).toEqual(fakeTask);
    expect(taskFixtures.length).toBe(before);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, text: 'New', assigneeStaffId: null, caseId: undefined }),
      }),
    );
  });

  it('create() throws a clear error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(tasksService.create(organization, { text: 'x', assigneeStaffId: null }, 'wix')).rejects.toThrow(
      'Failed to create task.',
    );
  });

  it('update() PATCHes /api/tasks/[taskId] with organizationId and the patch, never touching taskFixtures', async () => {
    const fakeUpdated = { id: 'task-1', organizationId: DEFAULT_ORGANIZATION_ID, text: 'Renamed', isDone: false, assigneeStaffId: null, caseId: null, createdAt: '2026-07-23T00:00:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ task: fakeUpdated }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await tasksService.update(organization, 'task-1', { text: 'Renamed' }, 'wix');

    expect(result).toEqual(fakeUpdated);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks/task-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, patch: { text: 'Renamed' } }),
      }),
    );
  });

  it('update() throws a clear error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(tasksService.update(organization, 'no-such-task', { isDone: true }, 'wix')).rejects.toThrow(
      /not found for this organization/,
    );
  });

  it('remove() DELETEs /api/tasks/[taskId] with organizationId as a query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await tasksService.remove(organization, 'task-1', 'wix');

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tasks/task-1?organizationId=${DEFAULT_ORGANIZATION_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('remove() treats a 404 as success (already gone), matching mock mode\'s "removing a nonexistent task is a no-op"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(tasksService.remove(organization, 'no-such-task', 'wix')).resolves.toBeUndefined();
  });

  it('remove() throws on a genuine failure (not 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(tasksService.remove(organization, 'task-1', 'wix')).rejects.toThrow(/Failed to remove task/);
  });
});
