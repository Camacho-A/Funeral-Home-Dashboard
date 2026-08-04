import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageResources } from '@/services/authorizationPolicyService';
import { update, setStatus, ResourceServiceError } from '@/services/resourceService';
import { getDataAdapterMode } from '@/lib/env';
import type { ResourceStatus } from '@/types/resource';

const VALID_STATUSES: readonly string[] = ['active', 'maintenance', 'out_of_service', 'archived'];

export async function PATCH(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { resourceId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; name?: unknown; locationId?: unknown; capacity?: unknown; notes?: unknown; status?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (b.status !== undefined && (typeof b.status !== 'string' || !VALID_STATUSES.includes(b.status))) {
    return NextResponse.json({ error: 'status must be a valid ResourceStatus if provided.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageResources({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to edit resources for this organization.' }, { status: 403 });
  }

  try {
    if (typeof b.status === 'string') {
      const resource = await setStatus(organizationId, resourceId, b.status as ResourceStatus, dataAdapterMode);
      return NextResponse.json({ resource });
    }
    const resource = await update(
      organizationId,
      resourceId,
      {
        name: typeof b.name === 'string' ? b.name : undefined,
        locationId: b.locationId === null ? null : typeof b.locationId === 'string' ? b.locationId : undefined,
        capacity: b.capacity === null ? null : typeof b.capacity === 'number' ? b.capacity : undefined,
        notes: b.notes === null ? null : typeof b.notes === 'string' ? b.notes : undefined,
      },
      dataAdapterMode,
    );
    return NextResponse.json({ resource });
  } catch (error) {
    if (error instanceof ResourceServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
