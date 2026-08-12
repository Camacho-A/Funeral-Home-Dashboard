import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadSchedule, canManageCalendar } from '@/services/authorizationPolicyService';
import { getReminderPolicy, updateReminderPolicy } from '@/services/appointmentReminderService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). The organization's `SchedulingReminderPolicy` — a
 * missing row resolves to the synthetic default, so `GET` always
 * succeeds for anyone with `schedule.read`. `PATCH` (the actual
 * configuration change) requires `calendar.manage`, its first real use
 * (§19/§21 of the plan).
 */
export async function GET(request: Request) {
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadSchedule({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view the reminder policy for this organization.' }, { status: 403 });
  }

  const policy = await getReminderPolicy(organizationId, dataAdapterMode);
  return NextResponse.json({ policy });
}

export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; leadTimesMinutes?: unknown; notifyOwner?: unknown; notifyFamily?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (b.leadTimesMinutes !== undefined && (!Array.isArray(b.leadTimesMinutes) || !b.leadTimesMinutes.every((n) => typeof n === 'number' && n > 0))) {
    return NextResponse.json({ error: 'leadTimesMinutes must be an array of positive numbers if provided.' }, { status: 400 });
  }
  if (b.notifyOwner !== undefined && typeof b.notifyOwner !== 'boolean') return NextResponse.json({ error: 'notifyOwner must be a boolean if provided.' }, { status: 400 });
  if (b.notifyFamily !== undefined && typeof b.notifyFamily !== 'boolean') return NextResponse.json({ error: 'notifyFamily must be a boolean if provided.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageCalendar({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to configure the reminder policy for this organization.' }, { status: 403 });
  }

  const policy = await updateReminderPolicy(
    organizationId,
    {
      leadTimesMinutes: Array.isArray(b.leadTimesMinutes) ? (b.leadTimesMinutes as number[]).slice().sort((x, y) => x - y) : undefined,
      notifyOwner: typeof b.notifyOwner === 'boolean' ? b.notifyOwner : undefined,
      notifyFamily: typeof b.notifyFamily === 'boolean' ? b.notifyFamily : undefined,
    },
    dataAdapterMode,
  );
  return NextResponse.json({ policy });
}
