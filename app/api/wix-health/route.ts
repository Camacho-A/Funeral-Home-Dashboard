import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { createWixServerClient } from '@/lib/wixClient';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { isAdminTier } from '@/services/authorizationPolicyService';

/**
 * Phase 12 (Wix Project Foundation). The minimal connectivity check the
 * phase asks for — proves the server can authenticate to Wix without
 * touching any business/case data. Deliberately calls the lightest
 * available read (site properties' display name) rather than anything
 * from a Data/CMS collection, since no production schema exists yet and
 * none should be implied by this endpoint.
 *
 * Returns only `siteDisplayName` on success — never the full Properties
 * object (which includes the site's contact address/phone) — keeping the
 * response itself minimal even though that fuller data isn't private
 * case/decedent information either way.
 *
 * In mock mode (the default), returns immediately with no Wix call at
 * all — this is what "mock mode still works without Wix credentials"
 * actually means for this endpoint specifically.
 *
 * Tenant-isolation hardening (2026-10): in wix mode the check is no longer
 * public — it names the shared Beacon site and surfaces raw connection
 * errors. It now requires a signed-in identity session holding an
 * administrator-tier membership in an organization this deployment serves
 * (the session's own selected organization; never a client-supplied id).
 * 401 without a valid identity session, 403 otherwise. The mock-mode
 * response (no Wix call, nothing site-specific) stays public.
 */
export async function GET() {
  const adapter = getDataAdapterMode();

  if (adapter === 'mock') {
    return NextResponse.json({
      adapter,
      connected: true,
      message: 'Mock mode — no Wix connection required.',
    });
  }

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const authz = await resolveMembershipAuthorizationContext(access.identitySession, access.dataAdapterMode);
  const { context } = authz.granted ? authz : { context: null };
  if (
    !context ||
    !(await isAdminTier({ identityId: context.userId, organizationId: context.organizationId, roleKey: context.role }, access.dataAdapterMode))
  ) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  try {
    const client = createWixServerClient();
    const response = await client.siteProperties.getSiteProperties();
    return NextResponse.json({
      adapter,
      connected: true,
      siteDisplayName: response.properties?.siteDisplayName ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ adapter, connected: false, error: message }, { status: 503 });
  }
}
