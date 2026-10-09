import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canCreateAppointment, canEditAppointment } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { getOrganization } from '@/services/organizationProvisioningService';
import { casesService } from '@/services/casesService';
import { createManualExpectedPickup, changeExpectedPickupDate } from '@/services/cremainsPickupService';
import { resolveCremainsPickupSettings } from '@/domain/organization/cremainsPickupCapability';
import { isLocalDate, weekdayOf } from '@/domain/scheduling/cremainsPickupSchedule';

/**
 * Expected Cremains Pickup — staff-managed date (2026-10).
 *
 * A dedicated route rather than the generic appointment endpoints, for two
 * reasons the generic one cannot satisfy:
 *   - it must use the DETERMINISTIC case-scoped appointment id, which is
 *     what makes "one pickup per case" structural rather than hopeful;
 *     the generic create mints a random id.
 *   - a pickup books no resources, so the generic create would store it as
 *     a draft rather than a real scheduled event.
 *
 * Organization is always the one `requireAuthorizedOrganization` resolves
 * for the authenticated caller — the body's own id is only ever a claim to
 * be validated, never trusted. The case is then re-read under that
 * authorized organization, so a caseId belonging to another tenant simply
 * does not resolve.
 *
 * Neither verb touches a checklist item, a paperwork date, or a workflow
 * stage. Recording an expectation is not an assertion that any task was
 * completed.
 */

type Body = { organizationId?: unknown; expectedDate?: unknown; notes?: unknown; reason?: unknown };

async function resolveContext(request: Request, caseId: string) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) } as const;
  }
  const b = body as Body;
  if (typeof b.organizationId !== 'string') {
    return { error: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) } as const;
  }
  if (typeof b.expectedDate !== 'string' || !isLocalDate(b.expectedDate)) {
    return { error: NextResponse.json({ error: 'expectedDate must be a valid YYYY-MM-DD date.' }, { status: 400 }) } as const;
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return { error: authResult.response } as const;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const organization = await getOrganization(organizationId, dataAdapterMode);
  const settings = resolveCremainsPickupSettings(
    organization ? { id: organization.id, cremainsPickupSettings: organization.cremainsPickupSettings } : null,
  );

  // Off-schedule dates are allowed, but only deliberately and with a
  // reason on the record — never silently shifted to another day.
  const weekday = weekdayOf(b.expectedDate);
  const onSchedule = weekday !== null && settings.allowedPickupWeekdays.includes(weekday);
  if (!onSchedule && !(typeof b.reason === 'string' && b.reason.trim())) {
    return {
      error: NextResponse.json(
        { error: 'This date is not one of this organization’s pickup days. A reason is required to use it.', requiresReason: true },
        { status: 422 },
      ),
    } as const;
  }

  // Re-read under the AUTHORIZED organization, so a caseId belonging to
  // another tenant simply does not resolve.
  const case_ = await casesService.get({ organizationId }, caseId, dataAdapterMode);
  if (!case_) return { error: NextResponse.json({ error: 'Case not found.' }, { status: 404 }) } as const;

  return {
    ok: true as const,
    organizationId,
    userId,
    role,
    dataAdapterMode,
    organization,
    case_,
    expectedDate: b.expectedDate,
    notes: typeof b.notes === 'string' ? b.notes : null,
    reason: typeof b.reason === 'string' ? b.reason : null,
    ctx: {
      organizationId,
      actorIdentityId: userId,
      actorMembershipId: null,
      actorRoleKey: role,
      correlationId: crypto.randomUUID(),
    },
  };
}

/** Create the case's expected pickup. Refuses if one already exists. */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const { caseId } = await params;

  const resolved = await resolveContext(request, caseId);
  if ('error' in resolved) return resolved.error;

  if (!(await canCreateAppointment({ identityId: resolved.userId, organizationId: resolved.organizationId, roleKey: resolved.role }, resolved.dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to schedule for this organization.' }, { status: 403 });
  }

  const result = await createManualExpectedPickup(
    {
      case_: resolved.case_,
      organization: resolved.organization
        ? { id: resolved.organization.id, timezone: resolved.organization.timezone, cremainsPickupSettings: resolved.organization.cremainsPickupSettings }
        : null,
      expectedDate: resolved.expectedDate,
      notes: resolved.notes,
      overrideReason: resolved.reason,
    },
    resolved.ctx,
    resolved.dataAdapterMode,
  );

  if (!result.created) {
    return NextResponse.json(
      {
        error:
          result.reason === 'already_exists'
            ? 'This case already has an expected cremains pickup. Edit the existing one instead.'
            : 'Invalid expected pickup date.',
        appointment: result.appointment,
      },
      { status: result.reason === 'already_exists' ? 409 : 422 },
    );
  }
  return NextResponse.json({ appointment: result.appointment }, { status: 201 });
}

/** Change the expected date on the case's existing pickup. */
export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const { caseId } = await params;

  const resolved = await resolveContext(request, caseId);
  if ('error' in resolved) return resolved.error;

  if (!(await canEditAppointment({ identityId: resolved.userId, organizationId: resolved.organizationId, roleKey: resolved.role }, resolved.dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to change this schedule.' }, { status: 403 });
  }

  const result = await changeExpectedPickupDate(
    {
      caseId: resolved.case_.id,
      organizationId: resolved.organizationId,
      organization: resolved.organization ? { id: resolved.organization.id, timezone: resolved.organization.timezone } : null,
      expectedDate: resolved.expectedDate,
      reason: resolved.reason,
    },
    resolved.ctx,
    resolved.dataAdapterMode,
  );

  if (!result.changed) {
    const status = result.reason === 'not_found' ? 404 : result.reason === 'terminal' ? 409 : 422;
    const message =
      result.reason === 'not_found'
        ? 'This case has no expected cremains pickup to edit.'
        : result.reason === 'terminal'
          ? 'This pickup has already been received or cancelled and can no longer be re-dated.'
          : 'Invalid expected pickup date.';
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ appointment: result.appointment });
}
