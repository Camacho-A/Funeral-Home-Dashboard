import { headers } from 'next/headers';
import { getDataAdapterMode, getLoginOrganizationHosts, getLoginOrganizationId } from '@/lib/env';
import { parseLoginOrganizationHosts, resolveLoginOrganizationId } from '@/domain/organization/loginBranding';
import { getForOrganization } from '@/services/organizationsService';
import { getBranding } from '@/services/organizationProvisioningService';

export type LoginOrganization = {
  /** The organization's display name, shown as "<name> Workspace". */
  name: string;
  /** A public branding-asset URL (services/organizationProvisioningService.ts
      #uploadBrandingLogo stores logos as public blobs), so rendering it on an
      unauthenticated page exposes nothing that wasn't already public.
      Prefers the sign-in logo and falls back to the compact sidebar mark for
      an organization that has only uploaded one. Null when neither exists —
      the workspace line alone then identifies the organization. */
  logoUrl: string | null;
};

/**
 * The organization this sign-in screen is branded for, or null for a
 * generic SOLIS login.
 *
 * Kept out of app/login/page.tsx so that file stays what its own comment
 * promises: markup and a message lookup, with no data or auth logic.
 *
 * Server-side only — it reads request headers, `DATA_ADAPTER`, and Wix
 * directly, none of which exists in a browser bundle. Its single caller
 * is the Login Server Component. (No `server-only` import: this codebase
 * has no such dependency and relies on the same convention everywhere
 * else in `services/*`.)
 *
 * **Nothing here reads user-controlled input.** The hostname is matched
 * against a map the DEPLOYMENT configured, and only branding — a public
 * logo and the display name — is ever read. No data behind authentication
 * is touched, and an unmapped host resolves to no organization at all
 * rather than to a default tenant.
 *
 * **Never throws.** A funeral home's staff must be able to sign in while
 * Wix is slow, misconfigured, or down, so every failure degrades to the
 * SOLIS lockup alone rather than an error page in front of the login
 * form. An organization with no logo uploaded is not a failure either —
 * its name is returned with a null `logoUrl`.
 */
export async function loadLoginOrganization(): Promise<LoginOrganization | null> {
  try {
    const requestHeaders = await headers();
    const organizationId = resolveLoginOrganizationId({
      host: requestHeaders.get('host'),
      hostOrganizationIds: parseLoginOrganizationHosts(getLoginOrganizationHosts()),
      configuredOrganizationId: getLoginOrganizationId(),
    });
    if (!organizationId) return null;

    const dataAdapterMode = getDataAdapterMode();
    const organization = await getForOrganization(organizationId, dataAdapterMode);
    const name = organization?.name?.trim();
    // A configured id naming an organization this deployment doesn't hold,
    // or one that has been suspended, leaves nothing to show — better
    // generic SOLIS than a logo with no owner.
    if (!organization || !organization.isActive || !name) return null;

    const branding = await getBranding(organizationId, dataAdapterMode);
    return { name, logoUrl: branding?.signInLogoUrl?.trim() || branding?.logoUrl?.trim() || null };
  } catch {
    // Branding is cosmetic; signing in is not.
    return null;
  }
}
