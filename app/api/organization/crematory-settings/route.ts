import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeCrematory } from '@/lib/crematory/routeAuth';
import { updateOrganization } from '@/services/organizationProvisioningService';
import { getOrganizationCrematorySettings } from '@/services/crematory/crematoryPackageService';
import { getCrematoryMailboxStatus } from '@/services/crematory/crematoryMailboxService';
import { CrematorySettingsError, normalizeRecipients } from '@/domain/crematory/crematorySettings';

/**
 * Send to Crematory (2026-10) — administrators. The crematory's default
 * recipients (entered here, never built in) and the connected mailbox.
 *   GET   → { settings, mailbox }
 *   PATCH { organizationId, settings: { to, cc } }
 */
export async function GET(request: Request) {
  const auth = await authorizeCrematory(new URL(request.url).searchParams.get('organizationId'), 'manage');
  if (!auth.context) return auth.response;
  const [settings, mailbox] = await Promise.all([
    getOrganizationCrematorySettings(auth.context.organizationId, auth.mode),
    getCrematoryMailboxStatus(auth.context.organizationId, auth.mode),
  ]);
  return NextResponse.json({ settings, mailbox }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  let body: { organizationId?: unknown; settings?: { to?: unknown; cc?: unknown } };
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const auth = await authorizeCrematory(body.organizationId, 'manage');
  if (!auth.context) return auth.response;
  try {
    const settings = normalizeRecipients(body.settings ?? {}, { requireTo: false });
    await updateOrganization(auth.context.organizationId, { crematorySettings: settings }, auth.mode);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof CrematorySettingsError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Crematory settings update failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The settings could not be saved. Please try again.' }, { status: 500 });
  }
}
