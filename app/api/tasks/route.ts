import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixTaskItem, type WixTaskItem } from '@/lib/wixTaskMapper';
import { taskFixtures } from '@/services/__mocks__/fixtures';
import type { CaseTask } from '@/types/task';

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
  const organizationId = url.searchParams.get('organizationId');
  const caseId = url.searchParams.get('caseId');

  if (!organizationId) {
    return NextResponse.json({ tasks: [], error: 'organizationId is required.' }, { status: 400 });
  }

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
