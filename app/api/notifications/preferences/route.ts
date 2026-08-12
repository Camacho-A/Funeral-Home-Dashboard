import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getPreferences, updatePreferences } from '@/services/notificationService';
import type { NotificationPreferencePatch, DigestFrequency, NotificationCategoryOverride } from '@/types/notificationPreference';
import type { NotificationCategory } from '@/domain/notifications/notificationTypeRegistry';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 28 (Communications & Notifications). The caller's own
 * `NotificationPreference` — no permission beyond authentication, since
 * this is always self-scoped.
 *
 * Phase 33 (Real Notification Delivery): every field this route now
 * accepts (`smsEnabled`/`digestFrequency`/`quietHoursStart`/
 * `quietHoursEnd`/`categoryOverrides`) was previously a schema-only
 * reserve, unexposed here — see types/notificationPreference.ts's own
 * header comment for what each now actually does.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const preferences = await getPreferences(organizationId, userId, dataAdapterMode);
  return NextResponse.json({ preferences });
}

const VALID_DIGEST_FREQUENCIES: readonly string[] = ['instant', 'daily', 'weekly'];
const VALID_CATEGORIES: readonly string[] = ['case', 'task', 'payment', 'scheduling', 'document', 'signature', 'organization', 'system', 'family_portal', 'financial'];

/** "HH:mm", 24-hour — the one format `domain/notifications/digestTiming.ts`'s
    lexicographic comparison assumes; validated here so a malformed value
    can never silently corrupt the quiet-hours check downstream. */
function isValidTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidCategoryOverride(value: unknown): value is NotificationCategoryOverride {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).emailEnabled === 'boolean' &&
    typeof (value as Record<string, unknown>).inAppEnabled === 'boolean' &&
    typeof (value as Record<string, unknown>).smsEnabled === 'boolean'
  );
}

function isValidCategoryOverrides(value: unknown): value is Partial<Record<NotificationCategory, NotificationCategoryOverride>> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, override]) => VALID_CATEGORIES.includes(key) && isValidCategoryOverride(override));
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
  const b = body as {
    organizationId?: unknown;
    emailEnabled?: unknown;
    inAppEnabled?: unknown;
    smsEnabled?: unknown;
    digestFrequency?: unknown;
    quietHoursStart?: unknown;
    quietHoursEnd?: unknown;
    categoryOverrides?: unknown;
  };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (b.emailEnabled !== undefined && typeof b.emailEnabled !== 'boolean') {
    return NextResponse.json({ error: 'emailEnabled must be a boolean if provided.' }, { status: 400 });
  }
  if (b.inAppEnabled !== undefined && typeof b.inAppEnabled !== 'boolean') {
    return NextResponse.json({ error: 'inAppEnabled must be a boolean if provided.' }, { status: 400 });
  }
  if (b.smsEnabled !== undefined && typeof b.smsEnabled !== 'boolean') {
    return NextResponse.json({ error: 'smsEnabled must be a boolean if provided.' }, { status: 400 });
  }
  if (b.digestFrequency !== undefined && (typeof b.digestFrequency !== 'string' || !VALID_DIGEST_FREQUENCIES.includes(b.digestFrequency))) {
    return NextResponse.json({ error: 'digestFrequency must be one of "instant"/"daily"/"weekly" if provided.' }, { status: 400 });
  }
  if (b.quietHoursStart !== undefined && b.quietHoursStart !== null && !isValidTimeString(b.quietHoursStart)) {
    return NextResponse.json({ error: 'quietHoursStart must be an "HH:mm" string or null if provided.' }, { status: 400 });
  }
  if (b.quietHoursEnd !== undefined && b.quietHoursEnd !== null && !isValidTimeString(b.quietHoursEnd)) {
    return NextResponse.json({ error: 'quietHoursEnd must be an "HH:mm" string or null if provided.' }, { status: 400 });
  }
  if (b.categoryOverrides !== undefined && !isValidCategoryOverrides(b.categoryOverrides)) {
    return NextResponse.json({ error: 'categoryOverrides must map real category keys to {emailEnabled, inAppEnabled, smsEnabled} if provided.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  // Only include keys the caller actually sent — an explicit `undefined`
  // in the patch object would overwrite the existing stored value (an
  // object spread does not distinguish "key absent" from "key set to
  // undefined"), silently clobbering whichever field wasn't part of this
  // particular request.
  const patch: NotificationPreferencePatch = {};
  if (typeof b.emailEnabled === 'boolean') patch.emailEnabled = b.emailEnabled;
  if (typeof b.inAppEnabled === 'boolean') patch.inAppEnabled = b.inAppEnabled;
  if (typeof b.smsEnabled === 'boolean') patch.smsEnabled = b.smsEnabled;
  if (typeof b.digestFrequency === 'string') patch.digestFrequency = b.digestFrequency as DigestFrequency;
  if (b.quietHoursStart !== undefined) patch.quietHoursStart = b.quietHoursStart as string | null;
  if (b.quietHoursEnd !== undefined) patch.quietHoursEnd = b.quietHoursEnd as string | null;
  if (b.categoryOverrides !== undefined) patch.categoryOverrides = b.categoryOverrides as Partial<Record<NotificationCategory, NotificationCategoryOverride>>;

  const preferences = await updatePreferences(organizationId, userId, patch, dataAdapterMode);
  return NextResponse.json({ preferences });
}
