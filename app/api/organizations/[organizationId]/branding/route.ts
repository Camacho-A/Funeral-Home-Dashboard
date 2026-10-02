import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { getBranding } from '@/services/organizationProvisioningService';

/**
 * Manors cleanup phase (Task #4, bottom-of-sidebar organization logo).
 * `getBranding` (Phase 20) already exists but was previously only ever
 * called from the onboarding flow (session-scoped, write-only from the
 * portal's perspective) — this is the first general, authenticated READ
 * path for an already-provisioned organization's own branding, so the
 * portal UI (e.g. Sidebar) can display it. Same `requireAuthorizedOrganization`
 * pattern as `GET /api/organizations/[organizationId]` — the path's
 * `organizationId` is untrusted input, re-derived from the caller's own
 * session/membership before use. Returns `{ branding: null }` for an
 * organization with no branding configured yet (every pre-existing
 * organization, including Manors today) rather than an error — "no
 * branding set" is an expected, common state, not a failure.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId: requestedOrganizationId } = await params;

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const dataAdapterMode = getDataAdapterMode();
  const branding = await getBranding(organizationId, dataAdapterMode);
  return NextResponse.json({ branding });
}
