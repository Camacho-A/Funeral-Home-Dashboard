import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageResources } from '@/services/authorizationPolicyService';
import { createUnavailability } from '@/services/resourceService';
import { getDataAdapterMode } from '@/lib/env';
import crypto from 'crypto';
import type { ResourceUnavailabilityReason } from '@/types/resourceUnavailability';

const VALID_REASONS: readonly string[] = ['maintenance', 'time_off', 'other'];

export async function POST(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { resourceId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; startAt?: unknown; endAt?: unknown; reason?: unknown; notes?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.startAt !== 'string' || typeof b.endAt !== 'string') return NextResponse.json({ error: 'startAt and endAt are required.' }, { status: 400 });
  if (typeof b.reason !== 'string' || !VALID_REASONS.includes(b.reason)) return NextResponse.json({ error: 'A valid reason is required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageResources({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to record resource unavailability for this organization.' }, { status: 403 });
  }

  const unavailability = await createUnavailability(
    organizationId,
    {
      resourceId,
      startAt: b.startAt,
      endAt: b.endAt,
      reason: b.reason as ResourceUnavailabilityReason,
      notes: typeof b.notes === 'string' ? b.notes : undefined,
      createdBy: userId ?? 'unknown',
      idFactory: () => crypto.randomUUID(),
    },
    dataAdapterMode,
  );
  return NextResponse.json({ unavailability }, { status: 201 });
}
