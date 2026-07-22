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

describe('tasksService.create/update/remove — untouched by Phase 15D', () => {
  it('create/update/remove continue to operate on the shared client-side taskFixtures array regardless of dataAdapterMode', async () => {
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
