import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems, updateWixDataItem, deleteWixDataItem } from '@/lib/wixDataApi';
import {
  mapWixTaskItem,
  validateAndPickTaskUpdate,
  applyTaskUpdateToWixData,
  type WixTaskItem,
} from '@/lib/wixTaskMapper';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';

/**
 * Phase 16 (Wix Write Integration). Updates or deletes one task by its
 * Beacon domain id, scoped by organizationId — see
 * docs/adr/ADR-016-wix-write-integration.md. There was no GET-by-id route
 * for tasks (Phase 15D — nothing ever needed one), but PATCH/DELETE
 * inherently need a task id in the path, so this file exists purely for
 * those two methods.
 *
 * Both methods require DATA_ADAPTER=wix (mock-mode task update/removal
 * stays on tasksService's existing client-side path, which never calls
 * this route). Both re-fetch the task by {beaconTaskId, organizationId}
 * first — the tenant-ownership check, and (for PATCH) the full existing
 * data Wix's full-replace update needs — before mutating; a task
 * belonging to another organization is 404, identical to a
 * fabricated/nonexistent id.
 */

async function findAuthorizedTask(taskId: string, organizationId: string) {
  const response = await queryWixDataItems<WixTaskItem>('tasks', {
    filter: { beaconTaskId: taskId, organizationId },
    paging: { limit: 1 },
  });
  const item = response.dataItems[0];
  if (!item || !mapWixTaskItem(item.data)) return null;
  return item;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;

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

  const { patch, errors } = validateAndPickTaskUpdate(b.patch);
  if (errors.length > 0) {
    return NextResponse.json({ task: null, error: `Invalid field(s): ${errors.join(', ')}` }, { status: 400 });
  }

  try {
    const existingItem = await findAuthorizedTask(taskId, organizationId);
    if (!existingItem) {
      return NextResponse.json({ task: null }, { status: 404 });
    }

    const mergedData = applyTaskUpdateToWixData(existingItem.data, patch);
    const updated = await updateWixDataItem<WixTaskItem>('tasks', existingItem.id, mergedData);
    const result = mapWixTaskItem(updated.data);
    if (!result) {
      return NextResponse.json({ task: null, error: 'Failed to update task.' }, { status: 500 });
    }

    return NextResponse.json({ task: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ task: null, error: message }, { status: 503 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  if (getDataAdapterMode() !== 'wix') {
    return NextResponse.json({ error: 'This endpoint requires DATA_ADAPTER=wix.' }, { status: 400 });
  }

  try {
    const existingItem = await findAuthorizedTask(taskId, organizationId);
    if (!existingItem) {
      return NextResponse.json({}, { status: 404 });
    }

    await deleteWixDataItem('tasks', existingItem.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
