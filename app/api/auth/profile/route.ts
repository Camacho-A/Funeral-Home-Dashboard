import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getIdentityById, updateIdentity } from '@/services/identityService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 33 (Real Notification Delivery). The caller's own `Identity` —
 * no permission beyond authentication, always self-scoped, mirroring
 * `app/api/notifications/preferences/route.ts`'s exact posture. Built
 * for this phase's one new editable field (`phone`, the gate for the SMS
 * notification channel) — no prior phase built a general identity-profile
 * editing surface, despite ADR-021's own plan text assuming one existed;
 * that assumption was wrong, corrected here rather than silently
 * papered over. `email`/`displayName` are returned but not patchable by
 * this route — changing either has its own, more consequential
 * implications (uniqueness, verification state) this phase does not
 * take on.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { userId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const identity = await getIdentityById(userId, dataAdapterMode);
  if (!identity) return NextResponse.json({ error: 'Identity not found.' }, { status: 404 });
  return NextResponse.json({ identity });
}

/** "HH:mm"-unrelated, plain E.164-ish sanity check — not a full phone
    validation library (none exists in this codebase, and a false-negative
    reject is worse than a permissive check here since the SMS provider
    itself is the real source of truth for deliverability). */
function isPlausiblePhone(value: unknown): value is string {
  return typeof value === 'string' && /^\+?[0-9\s()-]{7,20}$/.test(value);
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
  const b = body as { organizationId?: unknown; phone?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (b.phone !== undefined && b.phone !== null && !isPlausiblePhone(b.phone)) {
    return NextResponse.json({ error: 'phone must be a plausible phone number string or null.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { userId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const identity = await updateIdentity(userId, { phone: (b.phone as string | null | undefined) ?? null }, dataAdapterMode);
  if (!identity) return NextResponse.json({ error: 'Identity not found.' }, { status: 404 });
  return NextResponse.json({ identity });
}
