import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { getOrganization, updateOrganization } from '@/services/organizationProvisioningService';
import { getDataAdapterMode } from '@/lib/env';
import { isSlaTrackingEnabled, normalizeSlaSettings, resolveSlaSettings } from '@/domain/sla/slaSettings';

/**
 * SLA settings (2026-10). Administrators only (same check as the other
 * organization settings), scoped to the caller's own organization, and only
 * for an organization with SLA tracking. Submitted values are validated
 * field by field (domain/sla/slaSettings.ts); anything invalid falls back
 * to its default rather than being stored.
 */
async function authorize(
  organizationId: string,
): Promise<{ response: NextResponse } | { organizationId: string; mode: ReturnType<typeof getDataAdapterMode> }> {
  const auth = await requireAuthorizedOrganization(organizationId);
  if (!auth.authorized) return { response: auth.response as NextResponse };
  const mode = getDataAdapterMode();
  const { userId, organizationId: orgId, role } = auth.context;
  if (!(await canManageOrganization({ identityId: userId, organizationId: orgId, roleKey: role }, mode))) {
    return { response: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) };
  }
  if (!isSlaTrackingEnabled(orgId)) return { response: NextResponse.json({ error: 'SLA tracking is not enabled for this organization.' }, { status: 404 }) };
  return { organizationId: orgId, mode };
}

export async function GET(request: Request): Promise<NextResponse> {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const auth = await authorize(organizationId);
  if ('response' in auth) return auth.response;
  const organization = await getOrganization(auth.organizationId, auth.mode);
  return NextResponse.json({ settings: resolveSlaSettings(organization ?? { id: auth.organizationId }) });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = (body ?? {}) as { organizationId?: unknown; settings?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.settings !== 'object' || b.settings === null) return NextResponse.json({ error: 'settings are required.' }, { status: 400 });
  const auth = await authorize(b.organizationId);
  if ('response' in auth) return auth.response;

  // Stored without `enabled` — that is the organization profile's decision.
  const { enabled: _enabled, ...normalized } = normalizeSlaSettings(b.settings, true);
  void _enabled;
  const updated = await updateOrganization(auth.organizationId, { slaSettings: normalized }, auth.mode);
  if (!updated) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 });
  return NextResponse.json({ settings: resolveSlaSettings(updated) });
}
