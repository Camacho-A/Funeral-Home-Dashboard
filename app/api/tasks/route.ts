import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems, insertWixDataItem } from '@/lib/wixDataApi';
import { mapWixTaskItem, buildWixTaskData, type WixTaskItem } from '@/lib/wixTaskMapper';
import type { WixCaseItem } from '@/lib/wixCaseMapper';
import { taskFixtures } from '@/services/__mocks__/fixtures';
import type { CaseTask } from '@/types/task';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';

/**
 * Phase 15D (Wix Task Read Integration). Lists tasks for one organization,
 * optionally scoped to one case — see
 * docs/adr/ADR-014-wix-task-read-integration.md.
 *
 * There is no separate get-by-id endpoint: services/tasksService.ts never
 * had a get(taskId) function, and nothing consumes one — "list by case"
 * is already just list() with a caseId filter, matching the pre-existing
 * mock architecture exactly (see useCaseTasks.ts, which reuses useTasks).
 *
 * In mock mode: filters services/__mocks__/fixtures.ts's taskFixtures by
 * organizationId and, if provided, caseId — byte-for-byte the same logic
 * services/tasksService.ts's list() always ran. In practice this route is
 * never actually reached while dataAdapterMode is "mock" (tasksService
 * takes a local, zero-network path instead, to stay consistent with
 * create()/update()/remove()'s client-side fixture mutations — see
 * ADR-014) — kept for defense-in-depth and independent testability,
 * matching every other Phase 15 Route Handler's symmetric shape.
 *
 * In wix mode: queries the `tasks` collection filtered by organizationId
 * (plus caseId when provided), mapping each item via
 * lib/wixTaskMapper.ts (skipping malformed records rather than throwing).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const caseId = url.searchParams.get('caseId');

  if (!requestedOrganizationId) {
    return NextResponse.json({ tasks: [], error: 'organizationId is required.' }, { status: 400 });
  }

  // Phase 15X (Multi-Tenant Authorization Hardening): re-derived from the
  // caller's session/membership, never trusted from the query param.
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const adapter = getDataAdapterMode();

  if (adapter === 'mock') {
    const tasks = taskFixtures.filter(
      (t) => t.organizationId === organizationId && (caseId === null || t.caseId === caseId),
    );
    return NextResponse.json({ tasks });
  }

  try {
    const filter: Record<string, unknown> = { organizationId };
    if (caseId !== null) filter.caseId = caseId;

    const response = await queryWixDataItems<WixTaskItem>('tasks', { filter });

    const tasks = response.dataItems
      .map((item) => mapWixTaskItem(item.data))
      .filter((t): t is CaseTask => t !== null);

    return NextResponse.json({ tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ tasks: [], error: message }, { status: 503 });
  }
}

/**
 * Phase 16 (Wix Write Integration). Creates a task, persisted to Wix — see
 * docs/adr/ADR-016-wix-write-integration.md. Requires DATA_ADAPTER=wix
 * (mock-mode task creation stays on tasksService.create's existing
 * client-side path, which never calls this route).
 *
 * If `caseId` is provided, it's verified to belong to the same
 * organizationId (a fresh Wix query, not trusted from the body) before
 * the task is created — "if the task belongs to a case, verify tenant
 * consistency." A caseId that doesn't resolve is rejected with 400, not
 * silently ignored or silently linked anyway.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ task: null, error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ task: null, error: 'Invalid request body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ task: null, error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  if (getDataAdapterMode() !== 'wix') {
    return NextResponse.json({ task: null, error: 'This endpoint requires DATA_ADAPTER=wix.' }, { status: 400 });
  }

  if (typeof b.text !== 'string' || b.text.trim() === '') {
    return NextResponse.json({ task: null, error: 'Invalid or missing required field: text' }, { status: 400 });
  }
  if ('assigneeStaffId' in b && b.assigneeStaffId !== null && typeof b.assigneeStaffId !== 'string') {
    return NextResponse.json({ task: null, error: 'Invalid field: assigneeStaffId' }, { status: 400 });
  }
  if ('caseId' in b && b.caseId !== null && b.caseId !== undefined && typeof b.caseId !== 'string') {
    return NextResponse.json({ task: null, error: 'Invalid field: caseId' }, { status: 400 });
  }
  const caseId = typeof b.caseId === 'string' ? b.caseId : null;
  const assigneeStaffId = typeof b.assigneeStaffId === 'string' ? b.assigneeStaffId : null;

  try {
    if (caseId !== null) {
      const caseResponse = await queryWixDataItems<WixCaseItem>('cases', {
        filter: { beaconCaseId: caseId, organizationId, isArchived: false },
        paging: { limit: 1 },
      });
      if (!caseResponse.dataItems[0]) {
        return NextResponse.json(
          { task: null, error: 'caseId does not refer to a case in this organization.' },
          { status: 400 },
        );
      }
    }

    const beaconTaskId = crypto.randomUUID();
    const data = buildWixTaskData({
      beaconTaskId,
      organizationId,
      text: b.text,
      assigneeStaffId,
      caseId,
      createdAt: new Date().toISOString(),
    });

    const inserted = await insertWixDataItem<WixTaskItem>('tasks', data, beaconTaskId);
    const created = mapWixTaskItem(inserted.data);
    if (!created) {
      return NextResponse.json({ task: null, error: 'Failed to create task.' }, { status: 500 });
    }

    return NextResponse.json({ task: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ task: null, error: message }, { status: 503 });
  }
}
