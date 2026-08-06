import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadSchedule, canManageResources } from '@/services/authorizationPolicyService';
import { list, create } from '@/services/resourceService';
import { StaffAssignmentError } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';
import crypto from 'crypto';
import type { ResourceType } from '@/types/resource';

const VALID_RESOURCE_TYPES: readonly string[] = [
  'funeral_director',
  'staff',
  'vehicle',
  'chapel',
  'viewing_room',
  'meeting_room',
  'crematory',
  'cemetery',
  'equipment',
  'external_vendor',
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadSchedule({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view resources for this organization.' }, { status: 403 });
  }

  const resourceTypeParam = url.searchParams.get('resourceType');
  const resourceType = resourceTypeParam && VALID_RESOURCE_TYPES.includes(resourceTypeParam) ? (resourceTypeParam as ResourceType) : undefined;
  const locationId = url.searchParams.get('locationId') ?? undefined;

  const resources = await list(organizationId, { resourceType, locationId }, dataAdapterMode);
  return NextResponse.json({ resources });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as {
    organizationId?: unknown;
    resourceType?: unknown;
    name?: unknown;
    locationId?: unknown;
    linkedMembershipId?: unknown;
    linkedStaffProfileId?: unknown;
    capacity?: unknown;
    isExternal?: unknown;
    notes?: unknown;
  };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.resourceType !== 'string' || !VALID_RESOURCE_TYPES.includes(b.resourceType)) {
    return NextResponse.json({ error: 'A valid resourceType is required.' }, { status: 400 });
  }
  if (typeof b.name !== 'string' || !b.name.trim()) return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (b.linkedStaffProfileId !== undefined && typeof b.linkedStaffProfileId !== 'string') {
    return NextResponse.json({ error: 'linkedStaffProfileId must be a string if provided.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageResources({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to create resources for this organization.' }, { status: 403 });
  }

  try {
    const resource = await create(
      organizationId,
      {
        resourceType: b.resourceType as ResourceType,
        name: b.name,
        locationId: typeof b.locationId === 'string' ? b.locationId : undefined,
        linkedMembershipId: typeof b.linkedMembershipId === 'string' ? b.linkedMembershipId : undefined,
        linkedStaffProfileId: typeof b.linkedStaffProfileId === 'string' ? b.linkedStaffProfileId : undefined,
        capacity: typeof b.capacity === 'number' ? b.capacity : undefined,
        isExternal: b.isExternal === true,
        notes: typeof b.notes === 'string' ? b.notes : undefined,
        idFactory: () => crypto.randomUUID(),
      },
      dataAdapterMode,
    );
    return NextResponse.json({ resource }, { status: 201 });
  } catch (error) {
    if (error instanceof StaffAssignmentError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
